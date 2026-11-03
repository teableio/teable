/* eslint-disable @typescript-eslint/naming-convention */
import { setTimeout as delay } from 'node:timers/promises';
import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-pg';
import {
  getRandomString,
  ok,
  RecordWriteOperationKind,
  v2CoreTokens,
  type IRecordWritePlugin,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const WAIT_TIMEOUT_MS = 15_000;

type RecordRef = { id: string };
type ApiResult = { status: number; body: unknown };
type HeldGate = { pid: number; release(): Promise<void> };

type Fixture = {
  tableId: string;
  dbTableName: string;
  relationOid: number;
  markerFieldId: string;
  markerColumn: string;
  childrenFieldId: string;
  parentFieldId: string;
  ownerColumn: string;
  recordA: RecordRef;
  recordB: RecordRef;
};

type Instrumentation = {
  functionName: string;
  triggerName: string;
  attemptSequence: string;
  gateKey: string;
};

const advisoryKey = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

const postUpdateRecords = async (
  ctx: SharedTestContext,
  tableId: string,
  records: Array<{ id: string; fields: Record<string, unknown> }>
): Promise<ApiResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateRecords`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, records }),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
};

const linkIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('id' in item)) return [];
    return typeof item.id === 'string' ? [item.id] : [];
  });
};

const singleLinkId = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object' || !('id' in value)) return undefined;
  return typeof value.id === 'string' ? value.id : undefined;
};

const findRecord = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  record: RecordRef
) => {
  const found = records.find(({ id }) => id === record.id);
  if (!found) throw new Error(`Missing record ${record.id}`);
  return found;
};

const createFixture = async (ctx: SharedTestContext): Promise<Fixture> => {
  const titleFieldId = `fld${getRandomString(16)}`;
  const markerFieldId = `fld${getRandomString(16)}`;
  const table = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Self reciprocal marker ${getRandomString(8)}`,
    fields: [
      { id: titleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: markerFieldId, name: 'Marker', type: 'singleLineText' },
    ],
    views: [{ type: 'grid' }],
  });
  const tableMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', table.id)
    .executeTakeFirstOrThrow();
  const markerMeta = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('id', '=', markerFieldId)
    .executeTakeFirstOrThrow();
  if (!markerMeta.db_field_name) throw new Error('Missing marker database column');

  const childrenFieldId = `fld${getRandomString(16)}`;
  const parentFieldId = `fld${getRandomString(16)}`;
  const ownerColumn = `__fk_${parentFieldId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: table.id,
    field: {
      id: childrenFieldId,
      name: 'Children',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: table.id,
        lookupFieldId: titleFieldId,
        isOneWay: false,
        symmetricFieldId: parentFieldId,
        fkHostTableName: tableMeta.db_table_name,
        selfKeyName: ownerColumn,
        foreignKeyName: '__id',
      },
    },
  });

  const created = await ctx.createRecords(table.id, [
    { fields: { [titleFieldId]: 'Node one', [markerFieldId]: 'initial' } },
    { fields: { [titleFieldId]: 'Node two', [markerFieldId]: 'initial' } },
  ]);
  const ordered = await sql<{ record_id: string; relation_oid: number }>`
    SELECT __id AS record_id, tableoid::int AS relation_oid
    FROM ${sql.table(tableMeta.db_table_name)}
    WHERE __id IN (${created[0]!.id}, ${created[1]!.id})
    ORDER BY __id
  `.execute(ctx.testContainer.db);
  if (ordered.rows.length !== 2) throw new Error('Missing ordered reciprocal-link records');

  return {
    tableId: table.id,
    dbTableName: tableMeta.db_table_name,
    relationOid: ordered.rows[0]!.relation_oid,
    markerFieldId,
    markerColumn: markerMeta.db_field_name,
    childrenFieldId,
    parentFieldId,
    ownerColumn,
    recordA: { id: ordered.rows[0]!.record_id },
    recordB: { id: ordered.rows[1]!.record_id },
  };
};

const instrumentationNames = (): Instrumentation => {
  const prefix = `t8242_self_reciprocal_${getRandomString(10).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    triggerName: `${prefix}_gate_trg`,
    attemptSequence: `${prefix}_attempts`,
    gateKey: `${prefix}:before-main-update`,
  };
};

const installInstrumentation = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await sql`CREATE SEQUENCE ${sql.id('public', names.attemptSequence)}`.execute(
    ctx.testContainer.db
  );
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock_shared(
        ('x' || substr(md5(TG_ARGV[0]), 1, 16))::bit(64)::bigint
      );
      RETURN NULL;
    END;
    $$
  `.execute(ctx.testContainer.db);
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    BEFORE UPDATE OF ${sql.id(fixture.markerColumn)}
    ON ${sql.table(fixture.dbTableName)}
    FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(names.gateKey)}
    )
  `.execute(ctx.testContainer.db);
};

const dropInstrumentation = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await sql`DROP TRIGGER IF EXISTS ${sql.id(names.triggerName)} ON ${sql.table(
    fixture.dbTableName
  )}`.execute(ctx.testContainer.db);
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
  await sql`DROP SEQUENCE IF EXISTS ${sql.id('public', names.attemptSequence)}`.execute(
    ctx.testContainer.db
  );
};

const addAttemptCounter = (
  ctx: SharedTestContext,
  tableId: string,
  names: Instrumentation
): (() => void) => {
  const plugins = ctx.testContainer.container.resolve<IRecordWritePlugin[]>(
    v2CoreTokens.recordWritePlugins
  );
  const plugin: IRecordWritePlugin = {
    name: `${names.functionName}_attempt_counter`,
    enforce: 'pre',
    supports: (kind) => kind === RecordWriteOperationKind.updateMany,
    beforePersist: async (context) => {
      if (
        context.table.id().toString() !== tableId ||
        context.kind !== RecordWriteOperationKind.updateMany
      ) {
        return ok(undefined);
      }
      const transaction = getPostgresTransaction(context.executionContext, 'data');
      if (!context.isTransactionBound || !transaction) {
        throw new Error('Attempt counter requires an active data transaction');
      }
      // This runs before source-row locks on every UoW attempt. Sequence increments
      // survive rollback, so a deadlock victim cannot hide an automatic retry.
      await sql`SELECT nextval(${`public.${names.attemptSequence}`}::regclass)`.execute(
        transaction
      );
      return ok(undefined);
    },
  };
  plugins.push(plugin);
  return () => {
    const index = plugins.indexOf(plugin);
    if (index >= 0) plugins.splice(index, 1);
  };
};

const holdExclusiveGate = async (ctx: SharedTestContext, gateKey: string): Promise<HeldGate> => {
  const acquired = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const transaction = ctx.testContainer.db.transaction().execute(async (trx) => {
    const result = await sql<{ pid: number }>`
      SELECT pg_backend_pid()::int AS pid, pg_advisory_xact_lock(${advisoryKey(gateKey)})
    `.execute(trx);
    acquired.resolve(result.rows[0]!.pid);
    await release.promise;
  });
  void transaction.catch((error: unknown) => acquired.reject(error));

  return {
    pid: await acquired.promise,
    release: async () => {
      release.resolve();
      await transaction;
    },
  };
};

const waitForGateWaiters = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  gatePid: number
): Promise<number[]> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await sql<{ pid: number }>`
      SELECT activity.pid::int AS pid
      FROM pg_stat_activity AS activity
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND activity.state = 'active'
        AND activity.wait_event_type = 'Lock'
        AND ${gatePid} = ANY(pg_blocking_pids(activity.pid))
        AND EXISTS (
          SELECT 1
          FROM pg_locks AS relation_lock
          WHERE relation_lock.pid = activity.pid
            AND relation_lock.relation = ${fixture.relationOid}::oid
        )
      ORDER BY activity.pid
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 2) return result.rows.map(({ pid }) => pid);
    expect(result.rows.length, 'unexpected additional reciprocal-update gate waiters').toBeLessThan(
      2
    );
    await delay(20);
  }
  throw new Error('Both reciprocal mixed updates did not reach the PostgreSQL gate');
};

const sequenceCalls = async (ctx: SharedTestContext, sequenceName: string): Promise<number> => {
  const result = await sql<{ last_value: string | number; is_called: boolean }>`
    SELECT last_value, is_called FROM ${sql.id('public', sequenceName)}
  `.execute(ctx.testContainer.db);
  const row = result.rows[0]!;
  return row.is_called ? Number(row.last_value) : 0;
};

describe('self oneMany reciprocal mixed updates (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('commits reciprocal Children and Marker batches consistently without a deadlock retry', async () => {
    const fixture = await createFixture(ctx);
    const names = instrumentationNames();
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;
    let removeAttemptCounter: (() => void) | undefined;

    try {
      await installInstrumentation(ctx, fixture, names);
      removeAttemptCounter = addAttemptCounter(ctx, fixture.tableId, names);
      gate = await holdExclusiveGate(ctx, names.gateKey);

      const t1 = postUpdateRecords(ctx, fixture.tableId, [
        {
          id: fixture.recordA.id,
          fields: { [fixture.childrenFieldId]: [{ id: fixture.recordB.id }] },
        },
        { id: fixture.recordB.id, fields: { [fixture.markerFieldId]: 'keep' } },
      ]);
      requests.push(t1);
      void Promise.allSettled(requests);

      const t2 = postUpdateRecords(ctx, fixture.tableId, [
        {
          id: fixture.recordB.id,
          fields: { [fixture.childrenFieldId]: [{ id: fixture.recordA.id }] },
        },
        { id: fixture.recordA.id, fields: { [fixture.markerFieldId]: 'keep' } },
      ]);
      requests.push(t2);
      void Promise.allSettled(requests);

      const gateWaiters = await waitForGateWaiters(ctx, fixture, gate.pid);
      expect(new Set(gateWaiters).size).toBe(2);

      await gate.release();
      const results = await Promise.all(requests);
      const attempts = await sequenceCalls(ctx, names.attemptSequence);
      const evidence = JSON.stringify({ results, attempts, gateWaiters });

      expect
        .soft(
          results.map(({ status }) => status),
          evidence
        )
        .toEqual([200, 200]);
      expect
        .soft(
          results.map(({ body }) => body),
          evidence
        )
        .toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
      expect.soft(attempts, `deadlock transaction retry detected: ${evidence}`).toBe(2);

      await ctx.drainOutbox();
      const records = await ctx.listRecords(fixture.tableId);
      const recordA = findRecord(records, fixture.recordA);
      const recordB = findRecord(records, fixture.recordB);
      expect(recordA.fields[fixture.markerFieldId]).toBe('keep');
      expect(recordB.fields[fixture.markerFieldId]).toBe('keep');
      expect(linkIds(recordA.fields[fixture.childrenFieldId])).toEqual([fixture.recordB.id]);
      expect(linkIds(recordB.fields[fixture.childrenFieldId])).toEqual([fixture.recordA.id]);
      expect(singleLinkId(recordA.fields[fixture.parentFieldId])).toBe(fixture.recordB.id);
      expect(singleLinkId(recordB.fields[fixture.parentFieldId])).toBe(fixture.recordA.id);

      const physicalOwners = await sql<{ record_id: string; owner_id: string | null }>`
        SELECT __id AS record_id, ${sql.id(fixture.ownerColumn)} AS owner_id
        FROM ${sql.table(fixture.dbTableName)}
        WHERE __id IN (${fixture.recordA.id}, ${fixture.recordB.id})
      `.execute(ctx.testContainer.db);
      expect(new Map(physicalOwners.rows.map((row) => [row.record_id, row.owner_id]))).toEqual(
        new Map<string, string | null>([
          [fixture.recordA.id, fixture.recordB.id],
          [fixture.recordB.id, fixture.recordA.id],
        ])
      );
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      removeAttemptCounter?.();
      await dropInstrumentation(ctx, fixture, names);
    }
  }, 60_000);
});
