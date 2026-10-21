/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T6637 investigation: does manually interleaving two independently scheduled
 * outbox cascades (a User rename cascade "A" and an Order-own-field cascade
 * "B") permanently corrupt a mid-chain lookup/formula value
 * (lookup -> profileSeed/l1 -> profileL2/l2 -> profileL3/l3)?
 *
 * FINDING (see the accompanying report for full detail): under purely
 * sequential/manual driving — the only kind possible against a single-
 * connection pglite instance, per this package's own testing conventions —
 * the hypothesized "stale mid-chain overwrite that never gets re-dirtied"
 * bug could NOT be reproduced. Both tests below are green, and that is the
 * point: they are negative evidence, not the requested failing repro.
 *
 * Why it self-heals every way this was interleaved:
 *  - `tmp_computed_dirty` / the before-image table are `on commit drop`
 *    (transaction-scoped); no stale value is cached across a stage boundary
 *    (see ComputedFieldUpdater.resetDirtyTable/resetBeforeImageTable).
 *  - Every per-level write is one atomic `UPDATE target ... FROM (SELECT ...)`
 *    (UpdateFromSelectBuilder) that reads the CURRENT committed value of its
 *    upstream dependency and writes the result in a single statement — there
 *    is no "read now, write later" gap inside a stage.
 *  - The T6300 fix's dirty-target lock uses `pg_advisory_xact_lock` /
 *    `pg_try_advisory_xact_lock` (ComputedUpdateLock.ts) — transaction-scoped,
 *    auto-released on commit. Its `wait:false` requeue-and-recompute path can
 *    only ever fire for genuinely overlapping (concurrently open) DB
 *    transactions, which a single pglite connection cannot produce and which
 *    sequential (fully-commit-before-next-call) driving never creates either.
 *  - Consequently, whichever stage (from A or B) is chronologically the LAST
 *    to write a given level always reads the freshest upstream value at that
 *    moment, so the terminal state always matches "recompute the whole chain
 *    from the latest committed inputs" — regardless of interleaving order.
 *
 * The two tests below demonstrate this directly:
 *  1. `control` — no interleave at all (baseline sanity check).
 *  2. `interleaved (still converges)` — cascade A is driven through its first
 *     stage-pair (lookup + l1), then cascade B (an Order-own-field re-link,
 *     "dirty=1") is run to full completion, and only then is A resumed. Even
 *     though A's own l2/l3 continuation was planned back when l1 held a
 *     different (pre-B) value, A's l2 write re-reads l1 live and lands on
 *     the same value B already computed — no divergence, no dead letters.
 */
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  UpdateRecordCommand,
  v2CoreTokens,
  type BaseId,
  type CreateRecordResult,
  type CreateTableResult,
  type FieldId,
  type ICommandBus,
  type IExecutionContext,
  type RecordId as RecordIdType,
  type Table,
  type TableId,
  type UpdateRecordResult,
} from '@teable/v2-core';
import { sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getV2NodeTestContainer,
  peekV2NodeTestContainer,
  resetV2NodeTestContainer,
  setV2NodeTestContainer,
} from '../../../integration/testkit/v2NodeTestContainer';
import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { ComputedUpdateWorker } from '../worker/ComputedUpdateWorker';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

interface ICreateTableInput {
  name: string;
  fields: Array<{
    id?: string;
    type: string;
    name: string;
    isPrimary?: boolean;
    options?: Record<string, unknown>;
  }>;
}

const createTable = async (
  commandBus: ICommandBus,
  baseId: BaseId,
  input: ICreateTableInput
): Promise<{ table: Table; fieldIds: Map<string, FieldId> }> => {
  const command = CreateTableCommand.create({
    baseId: baseId.toString(),
    name: input.name,
    fields: input.fields,
    views: [{ type: 'grid' }],
  })._unsafeUnwrap();

  const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
    createContext(),
    command
  );
  const { table } = result._unsafeUnwrap();
  const fieldIds = new Map<string, FieldId>();
  for (const field of table.getFields()) {
    fieldIds.set(field.name().toString(), field.id());
  }
  return { table, fieldIds };
};

const createRecord = async (
  commandBus: ICommandBus,
  tableId: TableId,
  fields: Record<string, unknown>
): Promise<RecordIdType> => {
  const command = CreateRecordCommand.create({
    tableId: tableId.toString(),
    fields,
  })._unsafeUnwrap();
  const result = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
    createContext(),
    command
  );
  return result._unsafeUnwrap().record.id();
};

const updateRecord = async (
  commandBus: ICommandBus,
  tableId: TableId,
  recordId: string,
  fields: Record<string, unknown>
): Promise<void> => {
  const command = UpdateRecordCommand.create({
    tableId: tableId.toString(),
    recordId,
    fields,
  })._unsafeUnwrap();
  const result = await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
    createContext(),
    command
  );
  result._unsafeUnwrap();
};

type OutboxRow = {
  id: string;
  status: string;
  seed_table_id: string;
  run_id: string;
  run_total_steps: number;
  run_completed_steps_before: number;
  created_at: Date;
};

const dumpOutbox = async (
  testContainer: IV2NodeTestContainer,
  label: string
): Promise<OutboxRow[]> => {
  const rows = await sql<OutboxRow>`
    SELECT id, status, seed_table_id, run_id, run_total_steps, run_completed_steps_before, created_at
    FROM computed_update_outbox
    ORDER BY created_at, id
  `.execute(testContainer.db);
  // eslint-disable-next-line no-console
  console.log(
    `[outbox:${label}]`,
    rows.rows.map((r) => ({
      id: r.id.slice(-8),
      status: r.status,
      seedTable: r.seed_table_id.slice(-6),
      run: r.run_id.slice(-8),
      steps: `${r.run_completed_steps_before}/${r.run_total_steps}`,
    }))
  );
  return rows.rows;
};

const dbFieldName = (table: Table, fieldId: string): string =>
  table
    .getFields()
    .find((f) => f.id().toString() === fieldId)!
    .dbFieldName()
    ._unsafeUnwrap()
    .value()
    ._unsafeUnwrap();

const readOrderRow = async (
  testContainer: IV2NodeTestContainer,
  orderTable: Table,
  orderId: string,
  fieldIds: {
    lookupFieldId: string;
    l1FieldId: string;
    l2FieldId: string;
    l3FieldId: string;
  }
): Promise<{ lookup: unknown; l1: unknown; l2: unknown; l3: unknown }> => {
  const dbTableName = orderTable.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
  const db = testContainer.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
  const rows = await db.selectFrom(dbTableName).selectAll().where('__id', '=', orderId).execute();
  expect(rows.length).toBe(1);
  const row = rows[0];
  // Lookup columns are stored as JSON arrays even for many-one links; unwrap the
  // single value for readability in assertions/diagnostics.
  const unwrap = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);
  return {
    lookup: unwrap(row[dbFieldName(orderTable, fieldIds.lookupFieldId)]),
    l1: unwrap(row[dbFieldName(orderTable, fieldIds.l1FieldId)]),
    l2: unwrap(row[dbFieldName(orderTable, fieldIds.l2FieldId)]),
    l3: unwrap(row[dbFieldName(orderTable, fieldIds.l3FieldId)]),
  };
};

/**
 * Builds:
 *  - User: FirstName (primary)
 *  - Order: Status (primary), UserLink (link -> User), LookupFirstName (lookup),
 *    ProfileSeed/l1 = {LookupFirstName}
 *    ProfileL2/l2  = CONCATENATE({ProfileSeed}, "-L2")
 *    ProfileL3/l3  = CONCATENATE({ProfileL2}, "-L3")
 */
const buildSchema = async (commandBus: ICommandBus, baseId: BaseId) => {
  const firstNameFieldId = 'fldUserFirstName000' as string;
  const { table: userTable, fieldIds: userFieldIds } = await createTable(commandBus, baseId, {
    name: 'Users',
    fields: [{ type: 'singleLineText', id: firstNameFieldId, name: 'FirstName', isPrimary: true }],
  });

  const statusFieldId = 'fldOrderStatus00000';
  const userLinkFieldId = 'fldOrderUserLink000';
  const lookupFieldId = 'fldOrderLookupName0';
  const l1FieldId = 'fldOrderProfileSeed';
  const l2FieldId = 'fldOrderProfileL2000';
  const l3FieldId = 'fldOrderProfileL3000';

  const { table: orderTable } = await createTable(commandBus, baseId, {
    name: 'Orders',
    fields: [
      { type: 'singleLineText', id: statusFieldId, name: 'Status', isPrimary: true },
      {
        type: 'link',
        id: userLinkFieldId,
        name: 'UserLink',
        options: {
          relationship: 'manyOne',
          foreignTableId: userTable.id().toString(),
          lookupFieldId: userFieldIds.get('FirstName')!.toString(),
          isOneWay: true,
        },
      },
      {
        type: 'lookup',
        id: lookupFieldId,
        name: 'LookupFirstName',
        options: {
          linkFieldId: userLinkFieldId,
          foreignTableId: userTable.id().toString(),
          lookupFieldId: userFieldIds.get('FirstName')!.toString(),
        },
      },
      {
        type: 'formula',
        id: l1FieldId,
        name: 'ProfileSeed',
        options: { expression: `{${lookupFieldId}}` },
      },
      {
        type: 'formula',
        id: l2FieldId,
        name: 'ProfileL2',
        options: { expression: `CONCATENATE({${l1FieldId}}, "-L2")` },
      },
      {
        type: 'formula',
        id: l3FieldId,
        name: 'ProfileL3',
        options: { expression: `CONCATENATE({${l2FieldId}}, "-L3")` },
      },
    ],
  });

  return {
    userTable,
    orderTable,
    userNameFieldId: userFieldIds.get('FirstName')!,
    statusFieldId,
    userLinkFieldId,
    lookupFieldId,
    l1FieldId,
    l2FieldId,
    l3FieldId,
  };
};

describe('Computed cascade overlap (T6637 investigation — negative evidence, both green)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(
      await createV2NodeTestContainer({
        computedUpdate: {
          hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
          outboxConfig: {
            maxConcurrentProcessingPerBase: 2,
            maxConcurrentProcessingPerSeedTable: 2,
          },
        },
      })
    );
  });

  afterEach(async () => {
    const current = peekV2NodeTestContainer();
    await current?.dispose();
    resetV2NodeTestContainer();
  });

  it('control: single cascade (no interleave) converges to the recomputed-from-latest value', async () => {
    const testContainer = getV2NodeTestContainer();
    const { container, baseId } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const schema = await buildSchema(commandBus, baseId);
    const userId = await createRecord(commandBus, schema.userTable.id(), {
      [schema.userNameFieldId.toString()]: 'Alice',
    });
    const orderId = await createRecord(commandBus, schema.orderTable.id(), {
      [schema.statusFieldId]: 'Open',
      [schema.userLinkFieldId]: { id: userId.toString() },
    });

    await testContainer.processOutbox();
    await dumpOutbox(testContainer, 'after-create');

    let row = await readOrderRow(testContainer, schema.orderTable, orderId.toString(), schema);
    expect(row.l3).toBe('Alice-L2-L3');

    await updateRecord(commandBus, schema.userTable.id(), userId.toString(), {
      [schema.userNameFieldId.toString()]: 'Alice-Renamed',
    });
    await testContainer.processOutbox();
    await dumpOutbox(testContainer, 'after-rename-drained');

    row = await readOrderRow(testContainer, schema.orderTable, orderId.toString(), schema);
    expect(row.lookup).toBe('Alice-Renamed');
    expect(row.l1).toBe('Alice-Renamed');
    expect(row.l2).toBe('Alice-Renamed-L2');
    expect(row.l3).toBe('Alice-Renamed-L2-L3');
  });

  it('interleaved (still converges): drive cascade A partially, run cascade B to completion, resume A', async () => {
    const testContainer = getV2NodeTestContainer();
    const { container, baseId } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const worker = container.resolve<ComputedUpdateWorker>(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    );

    const schema = await buildSchema(commandBus, baseId);
    const userAId = await createRecord(commandBus, schema.userTable.id(), {
      [schema.userNameFieldId.toString()]: 'Bob',
    });
    const userBId = await createRecord(commandBus, schema.userTable.id(), {
      [schema.userNameFieldId.toString()]: 'Carol',
    });
    const orderId = await createRecord(commandBus, schema.orderTable.id(), {
      [schema.statusFieldId]: 'Open',
      [schema.userLinkFieldId]: { id: userAId.toString() },
    });
    await testContainer.processOutbox();

    // Cascade A: rename userA. Dirties LookupFirstName -> l1 -> l2 -> l3 on the order
    // (order is still linked to userA at this point).
    await updateRecord(commandBus, schema.userTable.id(), userAId.toString(), {
      [schema.userNameFieldId.toString()]: 'Bob-Renamed',
    });
    await dumpOutbox(testContainer, 'A-enqueued');

    // Drive exactly one runOnce() call: processes the initial claimed stage plus
    // whatever continuation it chases in-place (see ComputedUpdateWorker.processTaskQueue).
    const firstRun = await worker.runOnce({ workerId: 't6637-a', limit: 1 });
    expect(firstRun.isOk()).toBe(true);
    // eslint-disable-next-line no-console
    console.log(
      '[drive] first runOnce processed =',
      firstRun.isOk() ? firstRun.value : firstRun.error
    );
    await dumpOutbox(testContainer, 'A-after-first-runOnce');
    let mid = await readOrderRow(testContainer, schema.orderTable, orderId.toString(), schema);
    // eslint-disable-next-line no-console
    console.log('[state] after A first runOnce:', mid);

    // Cascade B: the order's own field changes — re-link it to userB. This is a
    // genuine "PATCH an order's own field" (dirty=1) that also re-derives the
    // whole lookup/formula chain, this time from a different (already-current)
    // source value.
    await updateRecord(commandBus, schema.orderTable.id(), orderId.toString(), {
      [schema.userLinkFieldId]: { id: userBId.toString() },
    });
    await dumpOutbox(testContainer, 'B-enqueued');

    // Run B fully to completion (its own chain only — runTaskById only chases
    // continuations that this task itself enqueues, never A's separate pending one).
    const outboxAfterB = await sql<OutboxRow>`
      SELECT id, status, seed_table_id, run_id, run_total_steps, run_completed_steps_before, created_at
      FROM computed_update_outbox
      WHERE status = 'pending'
      ORDER BY created_at, id
    `.execute(testContainer.db);
    const bTaskId = outboxAfterB.rows.find(
      (r) => r.seed_table_id === schema.orderTable.id().toString()
    )?.id;
    expect(bTaskId).toBeDefined();
    if (bTaskId) {
      // Drain B's whole chain (and any further continuations it spawns) without
      // touching A's pending continuation.
      // eslint-disable-next-line no-constant-condition
      for (let i = 0; i < 10; i++) {
        const r = await worker.runTaskById({ taskId: bTaskId, workerId: 't6637-b' });
        if (r.isErr() || !r.value) break;
      }
    }
    await dumpOutbox(testContainer, 'after-B-drained');
    mid = await readOrderRow(testContainer, schema.orderTable, orderId.toString(), schema);
    // eslint-disable-next-line no-console
    console.log('[state] after B fully drained:', mid);

    // Resume A: drain whatever remains.
    await testContainer.processOutbox();
    await dumpOutbox(testContainer, 'final');

    const final = await readOrderRow(testContainer, schema.orderTable, orderId.toString(), schema);
    // eslint-disable-next-line no-console
    console.log('[state] final:', final);

    // Expected: order is now linked to userB ("Carol"); the whole chain should
    // reflect that latest source, recomputed end-to-end.
    expect(final.lookup).toBe('Carol');
    expect(final.l1).toBe('Carol');
    expect(final.l2).toBe('Carol-L2');
    expect(final.l3).toBe('Carol-L2-L3');
  });
});
