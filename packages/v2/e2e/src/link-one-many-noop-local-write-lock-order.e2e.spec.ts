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

const INTERNAL_BATCH_SIZE = 1_000;
const WAIT_TIMEOUT_MS = 15_000;
const T1_X_MARKER = 'T1 wrote X';
const T1_Y_MARKER = 'T1 wrote Y';
const T2_X_MARKER = 'T2 wrote X';
const T2_Y_MARKER = 'T2 wrote Y';

type RecordRef = { id: string };
type ApiResult = { status: number; body: unknown };
type HeldGate = { pid: number; release(): Promise<void> };
type RequestBoundary =
  | { state: 'settled' }
  | { state: 'blocked-by-t1'; pid: number }
  | { state: 'at-y-gate'; pid: number };

type Fixture = {
  tableId: string;
  dbTableName: string;
  titleFieldId: string;
  markerFieldId: string;
  markerColumn: string;
  childrenFieldId: string;
  parentFieldId: string;
  childrenColumn: string;
  parentColumn: string;
  ownerColumn: string;
  parentA: RecordRef;
  childX: RecordRef;
  childY: RecordRef;
  fillers: RecordRef[];
};

type Instrumentation = {
  functionName: string;
  statementTrigger: string;
  rowTrigger: string;
  t1AttemptSequence: string;
  t2AttemptSequence: string;
  statementSequence: string;
  ySequence: string;
  t1GateKey: string;
  yGateKey: string;
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

const createRecordsInChunks = async (
  ctx: SharedTestContext,
  tableId: string,
  titleFieldId: string,
  count: number
): Promise<RecordRef[]> => {
  const records: RecordRef[] = [];
  for (let offset = 0; offset < count; offset += 250) {
    const size = Math.min(250, count - offset);
    records.push(
      ...(await ctx.createRecords(
        tableId,
        Array.from({ length: size }, (_, index) => ({
          fields: { [titleFieldId]: `Pending-lock filler ${offset + index}` },
        }))
      ))
    );
  }
  return records;
};

const createFixture = async (ctx: SharedTestContext): Promise<Fixture> => {
  const titleFieldId = `fld${getRandomString(16)}`;
  const markerFieldId = `fld${getRandomString(16)}`;
  const table = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Pending release subset ${getRandomString(8)}`,
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

  const fieldRows = await ctx.testContainer.db
    .selectFrom('field')
    .select(['id', 'db_field_name'])
    .where('table_id', '=', table.id)
    .where('id', 'in', [markerFieldId, childrenFieldId, parentFieldId])
    .execute();
  const columnByFieldId = new Map(fieldRows.map((row) => [row.id, row.db_field_name]));
  const markerColumn = columnByFieldId.get(markerFieldId);
  const childrenColumn = columnByFieldId.get(childrenFieldId);
  const parentColumn = columnByFieldId.get(parentFieldId);
  if (!markerColumn || !childrenColumn || !parentColumn) {
    throw new Error('Missing pending-release fixture columns');
  }

  const [parentA, candidateOne, candidateTwo] = await ctx.createRecords(table.id, [
    { fields: { [titleFieldId]: 'A' } },
    { fields: { [titleFieldId]: 'Candidate one' } },
    { fields: { [titleFieldId]: 'Candidate two' } },
  ]);
  if (!parentA || !candidateOne || !candidateTwo) {
    throw new Error('Missing A/X/Y records');
  }
  // The request below is explicitly Y then X. Choosing the lower record key for
  // Y also makes PostgreSQL's indexed two-row plan exercise that physical order.
  const orderedChildren = [candidateOne, candidateTwo].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const childY = orderedChildren[0]!;
  const childX = orderedChildren[1]!;
  const fillers = await createRecordsInChunks(ctx, table.id, titleFieldId, INTERNAL_BATCH_SIZE - 1);

  await ctx.updateRecord(table.id, parentA.id, {
    [childrenFieldId]: [{ id: childX.id }],
  });
  await ctx.drainOutbox();

  // Preserve the owning FK and inverse cache on X while making A's explicit []
  // a source-row no-op. The first internal batch must therefore capture X's
  // release generation instead of relying on a physical UPDATE of A.
  await sql`
    UPDATE ${sql.table(tableMeta.db_table_name)}
    SET ${sql.ref(childrenColumn)} = '[]'::jsonb
    WHERE __id = ${parentA.id}
  `.execute(ctx.testContainer.db);

  return {
    tableId: table.id,
    dbTableName: tableMeta.db_table_name,
    titleFieldId,
    markerFieldId,
    markerColumn,
    childrenFieldId,
    parentFieldId,
    childrenColumn,
    parentColumn,
    ownerColumn,
    parentA,
    childX,
    childY,
    fillers,
  };
};

const instrumentationNames = (): Instrumentation => {
  const prefix = `t8242_pending_subset_${getRandomString(8).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    statementTrigger: `${prefix}_statement_trg`,
    rowTrigger: `${prefix}_row_trg`,
    t1AttemptSequence: `${prefix}_t1_attempt_seq`,
    t2AttemptSequence: `${prefix}_t2_attempt_seq`,
    statementSequence: `${prefix}_statement_seq`,
    ySequence: `${prefix}_y_seq`,
    t1GateKey: `${prefix}:t1-before-local-write`,
    yGateKey: `${prefix}:t2-after-y-lock`,
  };
};

const installInstrumentation = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  for (const sequence of [
    names.t1AttemptSequence,
    names.t2AttemptSequence,
    names.statementSequence,
    names.ySequence,
  ]) {
    await sql`CREATE SEQUENCE ${sql.id('public', sequence)}`.execute(ctx.testContainer.db);
  }
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      statement_number bigint;
    BEGIN
      IF TG_LEVEL = 'STATEMENT' THEN
        statement_number := nextval(TG_ARGV[0]::regclass);
        IF statement_number = 1 THEN
          PERFORM pg_advisory_xact_lock(
            ('x' || substr(md5(TG_ARGV[1]), 1, 16))::bit(64)::bigint
          );
        END IF;
        RETURN NULL;
      END IF;

      IF NEW.__id = TG_ARGV[0]
        AND to_jsonb(NEW) ->> TG_ARGV[1] = TG_ARGV[2]
      THEN
        PERFORM nextval(TG_ARGV[3]::regclass);
        PERFORM pg_advisory_xact_lock(
          ('x' || substr(md5(TG_ARGV[4]), 1, 16))::bit(64)::bigint
        );
      END IF;
      RETURN NEW;
    END;
    $$
  `.execute(ctx.testContainer.db);
  // T1's first internal batch writes only filler titles. Its second batch is the
  // first Marker statement, so this gate is entered after any pre-statement
  // pending-release locks but before the ordinary X/Y UPDATE starts.
  await sql`
    CREATE TRIGGER ${sql.id(names.statementTrigger)}
    BEFORE UPDATE OF ${sql.id(fixture.markerColumn)}
    ON ${sql.table(fixture.dbTableName)}
    FOR EACH STATEMENT
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.statementSequence}`)},
      ${sql.lit(names.t1GateKey)}
    )
  `.execute(ctx.testContainer.db);
  // If T2 reaches Y before waiting for X, stop it while its transaction owns Y.
  // The sequence increment survives a deadlock rollback and distinguishes this
  // dangerous partial-lock state from safe serialization before Y is touched.
  await sql`
    CREATE TRIGGER ${sql.id(names.rowTrigger)}
    AFTER UPDATE OF ${sql.id(fixture.markerColumn)}
    ON ${sql.table(fixture.dbTableName)}
    FOR EACH ROW
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(fixture.childY.id)},
      ${sql.lit(fixture.markerColumn)},
      ${sql.lit(T2_Y_MARKER)},
      ${sql.lit(`public.${names.ySequence}`)},
      ${sql.lit(names.yGateKey)}
    )
  `.execute(ctx.testContainer.db);
};

const dropInstrumentation = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  for (const trigger of [names.statementTrigger, names.rowTrigger]) {
    await sql`DROP TRIGGER IF EXISTS ${sql.id(trigger)} ON ${sql.table(
      fixture.dbTableName
    )}`.execute(ctx.testContainer.db);
  }
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
  for (const sequence of [
    names.t1AttemptSequence,
    names.t2AttemptSequence,
    names.statementSequence,
    names.ySequence,
  ]) {
    await sql`DROP SEQUENCE IF EXISTS ${sql.id('public', sequence)}`.execute(ctx.testContainer.db);
  }
};

const addAttemptCounter = (
  ctx: SharedTestContext,
  fixture: Fixture,
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
      if (context.table.id().toString() !== fixture.tableId) return ok(undefined);
      if (context.kind !== RecordWriteOperationKind.updateMany) return ok(undefined);
      if (context.payload.variant !== 'explicit') return ok(undefined);
      const requestRecordIds = context.payload.recordUpdates.map(({ recordId }) =>
        recordId.toString()
      );
      const sequence = requestRecordIds.includes(fixture.parentA.id)
        ? names.t1AttemptSequence
        : requestRecordIds.length === 2 &&
            requestRecordIds.includes(fixture.childY.id) &&
            requestRecordIds.includes(fixture.childX.id)
          ? names.t2AttemptSequence
          : undefined;
      if (!sequence) return ok(undefined);

      const transaction = getPostgresTransaction(context.executionContext, 'data');
      if (!context.isTransactionBound || !transaction) {
        throw new Error('Attempt counter requires an active data transaction');
      }
      // PostgreSQL sequences do not roll back. A deadlock victim retried by the
      // command layer therefore remains visible even when its first attempt did
      // not reach either instrumented UPDATE statement.
      await sql`SELECT nextval(${`public.${sequence}`}::regclass)`.execute(transaction);
      return ok(undefined);
    },
  };
  plugins.push(plugin);
  return () => {
    const index = plugins.indexOf(plugin);
    if (index >= 0) plugins.splice(index, 1);
  };
};

const holdGate = async (ctx: SharedTestContext, key: string): Promise<HeldGate> => {
  const acquired = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const transaction = ctx.testContainer.db.transaction().execute(async (trx) => {
    const result = await sql<{ pid: number }>`
      SELECT pg_backend_pid()::int AS pid, pg_advisory_xact_lock(${advisoryKey(key)})
    `.execute(trx);
    acquired.resolve(result.rows[0]!.pid);
    await release.promise;
  });
  void transaction.catch((error: unknown) => acquired.reject(error));

  let released = false;
  return {
    pid: await acquired.promise,
    release: async () => {
      if (!released) {
        released = true;
        release.resolve();
      }
      await transaction;
    },
  };
};

const waitForBlockedBackend = async (
  ctx: SharedTestContext,
  blockerPid: number,
  description: string
): Promise<number> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await sql<{ pid: number }>`
      SELECT pid::int AS pid
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return result.rows[0]!.pid;
    expect(result.rows, `unexpected additional waiters: ${description}`).toHaveLength(0);
    await delay(20);
  }
  throw new Error(`PostgreSQL did not observe ${description}`);
};

const waitForRequestBoundary = async (
  ctx: SharedTestContext,
  settled: () => boolean,
  t1Pid: number,
  yGatePid: number
): Promise<RequestBoundary> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (settled()) return { state: 'settled' };
    const result = await sql<{ pid: number; blockers: number[] }>`
      SELECT pid::int AS pid, pg_blocking_pids(pid)::int[] AS blockers
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND (
          ${t1Pid} = ANY(pg_blocking_pids(pid))
          OR ${yGatePid} = ANY(pg_blocking_pids(pid))
        )
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) {
      const row = result.rows[0]!;
      if (row.blockers.includes(yGatePid)) return { state: 'at-y-gate', pid: row.pid };
      if (row.blockers.includes(t1Pid)) return { state: 'blocked-by-t1', pid: row.pid };
    }
    expect(result.rows, 'only T2 may join the X/Y lock boundary').toHaveLength(0);
    await delay(20);
  }
  throw new Error('PostgreSQL observed neither T2 completion nor an X/Y lock boundary');
};

const sequenceCalls = async (ctx: SharedTestContext, sequence: string): Promise<number> => {
  const result = await sql<{ last_value: string | number; is_called: boolean }>`
    SELECT last_value, is_called FROM ${sql.id('public', sequence)}
  `.execute(ctx.testContainer.db);
  const row = result.rows[0]!;
  return row.is_called ? Number(row.last_value) : 0;
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

describe('pending no-op release subset lock order (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('fails stale T1 once without a deadlock retry and succeeds from a fresh snapshot', async () => {
    const fixture = await createFixture(ctx);
    const names = instrumentationNames();
    const requests: Promise<ApiResult>[] = [];
    let t1Gate: HeldGate | undefined;
    let yGate: HeldGate | undefined;
    let removeAttemptCounter: (() => void) | undefined;

    try {
      const initial = await sql<{
        record_id: string;
        children: unknown;
        parent: unknown;
        owner_id: string | null;
      }>`
        SELECT __id AS record_id,
          ${sql.ref(fixture.childrenColumn)} AS children,
          ${sql.ref(fixture.parentColumn)} AS parent,
          ${sql.ref(fixture.ownerColumn)} AS owner_id
        FROM ${sql.table(fixture.dbTableName)}
        WHERE __id IN (${fixture.parentA.id}, ${fixture.childX.id})
      `.execute(ctx.testContainer.db);
      const initialById = new Map(initial.rows.map((row) => [row.record_id, row]));
      expect(initialById.get(fixture.parentA.id)?.children).toEqual([]);
      expect(initialById.get(fixture.childX.id)).toMatchObject({
        parent: expect.objectContaining({ id: fixture.parentA.id }),
        owner_id: fixture.parentA.id,
      });

      // Instrument only after fixture setup so both non-rollback counters cover
      // exactly the two concurrent HTTP commands below.
      await installInstrumentation(ctx, fixture, names);
      removeAttemptCounter = addAttemptCounter(ctx, fixture, names);
      t1Gate = await holdGate(ctx, names.t1GateKey);
      yGate = await holdGate(ctx, names.yGateKey);

      const t1Updates = [
        { id: fixture.parentA.id, fields: { [fixture.childrenFieldId]: [] } },
        ...fixture.fillers.map((record, index) => ({
          id: record.id,
          fields: { [fixture.titleFieldId]: `Pending-lock filler updated ${index}` },
        })),
        { id: fixture.childX.id, fields: { [fixture.markerFieldId]: T1_X_MARKER } },
        { id: fixture.childY.id, fields: { [fixture.markerFieldId]: T1_Y_MARKER } },
      ];
      expect(t1Updates).toHaveLength(INTERNAL_BATCH_SIZE + 2);
      expect(t1Updates[INTERNAL_BATCH_SIZE]?.id).toBe(fixture.childX.id);
      expect(t1Updates[INTERNAL_BATCH_SIZE + 1]?.id).toBe(fixture.childY.id);
      const t1 = postUpdateRecords(ctx, fixture.tableId, t1Updates);
      requests.push(t1);
      void Promise.allSettled(requests);
      // A + 999 fillers are exactly the first internal batch. Reaching this
      // second-batch statement gate proves A's no-op token has already been captured.
      const t1Pid = await waitForBlockedBackend(
        ctx,
        t1Gate.pid,
        'T1 blocked before its second-batch ordinary X/Y write'
      );

      let t2Settled = false;
      const t2Updates = [
        { id: fixture.childY.id, fields: { [fixture.markerFieldId]: T2_Y_MARKER } },
        { id: fixture.childX.id, fields: { [fixture.markerFieldId]: T2_X_MARKER } },
      ];
      expect(t2Updates.map(({ id }) => id)).toEqual([fixture.childY.id, fixture.childX.id]);
      const t2 = postUpdateRecords(ctx, fixture.tableId, t2Updates);
      void t2.then(
        () => {
          t2Settled = true;
        },
        () => {
          t2Settled = true;
        }
      );
      requests.push(t2);
      void Promise.allSettled(requests);

      const yBoundary = await waitForRequestBoundary(ctx, () => t2Settled, t1Pid, yGate.pid);
      if (yBoundary.state !== 'at-y-gate') {
        throw new Error(`T2 did not lock Y before continuing to X: ${JSON.stringify(yBoundary)}`);
      }
      expect(await sequenceCalls(ctx, names.ySequence)).toBe(1);
      await yGate.release();

      // T2 must commit its ordinary Y -> X write while T1 remains at the
      // second-batch gate. Pre-locking only X here would instead make T2 wait
      // behind T1 after already retaining Y, creating the crossed lock cycle.
      const boundary = await waitForRequestBoundary(ctx, () => t2Settled, t1Pid, yGate.pid);
      expect(boundary).toEqual({ state: 'settled' });
      const t2Result = await t2;

      await t1Gate.release();
      const t1Result = await t1;
      const attemptsAfterConflict = {
        t1Transactions: await sequenceCalls(ctx, names.t1AttemptSequence),
        t2Transactions: await sequenceCalls(ctx, names.t2AttemptSequence),
        markerStatements: await sequenceCalls(ctx, names.statementSequence),
        t2YRows: await sequenceCalls(ctx, names.ySequence),
      };
      const conflictEvidence = JSON.stringify({
        t1Result,
        t2Result,
        attempts: attemptsAfterConflict,
        boundary,
      });

      expect(t2Result.status, conflictEvidence).toBe(200);
      expect(t2Result.body, conflictEvidence).toEqual(expect.objectContaining({ ok: true }));
      expect(t1Result.status, conflictEvidence).toBeGreaterThanOrEqual(400);
      expect(t1Result.status, conflictEvidence).toBeLessThan(500);
      expect(JSON.stringify(t1Result.body), conflictEvidence).toContain(
        'conflict.link.noop_release_generation_changed'
      );
      expect(
        attemptsAfterConflict,
        `deadlock retry or hidden command retry detected: ${conflictEvidence}`
      ).toEqual({
        t1Transactions: 1,
        t2Transactions: 1,
        markerStatements: 2,
        t2YRows: 1,
      });

      // T1's generation conflict is atomic: its 999 first-batch filler writes,
      // its second-batch markers, and its pending release all roll back. T2
      // changes Marker only, not the title or link fields that drive Children;
      // it must not be assumed to repair A's deliberately stale [] cache.
      // Preserve that exact historical baseline until the explicit fresh retry.
      await ctx.drainOutbox();
      const recordsAfterConflict = [
        ...(await ctx.listRecordsWithoutDrain(fixture.tableId, {
          limit: INTERNAL_BATCH_SIZE,
          offset: 0,
        })),
        ...(await ctx.listRecordsWithoutDrain(fixture.tableId, {
          limit: INTERNAL_BATCH_SIZE,
          offset: INTERNAL_BATCH_SIZE,
        })),
      ];
      const parentAfterConflict = findRecord(recordsAfterConflict, fixture.parentA);
      const xAfterConflict = findRecord(recordsAfterConflict, fixture.childX);
      const yAfterConflict = findRecord(recordsAfterConflict, fixture.childY);
      expect(linkIds(parentAfterConflict.fields[fixture.childrenFieldId])).toEqual([]);
      expect(singleLinkId(xAfterConflict.fields[fixture.parentFieldId])).toBe(fixture.parentA.id);
      expect(singleLinkId(yAfterConflict.fields[fixture.parentFieldId])).toBeUndefined();
      expect(xAfterConflict.fields[fixture.markerFieldId]).toBe(T2_X_MARKER);
      expect(yAfterConflict.fields[fixture.markerFieldId]).toBe(T2_Y_MARKER);
      expect(
        fixture.fillers.map(
          (record) => findRecord(recordsAfterConflict, record).fields[fixture.titleFieldId]
        )
      ).toEqual(fixture.fillers.map((_, index) => `Pending-lock filler ${index}`));

      const physicalAfterConflict = await sql<{
        record_id: string;
        marker: string | null;
        children: unknown;
        parent: unknown;
        owner_id: string | null;
      }>`
        SELECT __id AS record_id,
          ${sql.ref(fixture.markerColumn)} AS marker,
          ${sql.ref(fixture.childrenColumn)} AS children,
          ${sql.ref(fixture.parentColumn)} AS parent,
          ${sql.ref(fixture.ownerColumn)} AS owner_id
        FROM ${sql.table(fixture.dbTableName)}
        WHERE __id IN (${fixture.parentA.id}, ${fixture.childX.id}, ${fixture.childY.id})
      `.execute(ctx.testContainer.db);
      const physicalAfterConflictById = new Map(
        physicalAfterConflict.rows.map((row) => [row.record_id, row])
      );
      expect(physicalAfterConflictById.get(fixture.parentA.id)?.children).toEqual(
        initialById.get(fixture.parentA.id)?.children
      );
      expect(physicalAfterConflictById.get(fixture.childX.id)).toMatchObject({
        marker: T2_X_MARKER,
        parent: initialById.get(fixture.childX.id)?.parent,
        owner_id: fixture.parentA.id,
      });
      expect(physicalAfterConflictById.get(fixture.childY.id)).toMatchObject({
        marker: T2_Y_MARKER,
        parent: null,
        owner_id: null,
      });

      // The conflict is recoverable. Repeating the same complete HTTP command
      // from a fresh snapshot must succeed once, clear A -> X, and commit every
      // ordinary field write that the failed attempt rolled back.
      const retry = postUpdateRecords(ctx, fixture.tableId, t1Updates);
      requests.push(retry);
      void Promise.allSettled(requests);
      const retryResult = await retry;
      expect(retryResult.status, JSON.stringify(retryResult.body)).toBe(200);
      expect(retryResult.body).toEqual(expect.objectContaining({ ok: true }));
      const attemptsAfterRetry = {
        t1Transactions: await sequenceCalls(ctx, names.t1AttemptSequence),
        t2Transactions: await sequenceCalls(ctx, names.t2AttemptSequence),
        markerStatements: await sequenceCalls(ctx, names.statementSequence),
        t2YRows: await sequenceCalls(ctx, names.ySequence),
      };
      expect(attemptsAfterRetry, 'fresh retry must add exactly one T1 transaction').toEqual({
        t1Transactions: 2,
        t2Transactions: 1,
        markerStatements: 3,
        t2YRows: 1,
      });

      await ctx.drainOutbox();
      const finalRecords = [
        ...(await ctx.listRecordsWithoutDrain(fixture.tableId, {
          limit: INTERNAL_BATCH_SIZE,
          offset: 0,
        })),
        ...(await ctx.listRecordsWithoutDrain(fixture.tableId, {
          limit: INTERNAL_BATCH_SIZE,
          offset: INTERNAL_BATCH_SIZE,
        })),
      ];
      const finalParent = findRecord(finalRecords, fixture.parentA);
      const finalX = findRecord(finalRecords, fixture.childX);
      const finalY = findRecord(finalRecords, fixture.childY);
      expect(linkIds(finalParent.fields[fixture.childrenFieldId])).toEqual([]);
      expect(singleLinkId(finalX.fields[fixture.parentFieldId])).toBeUndefined();
      expect(singleLinkId(finalY.fields[fixture.parentFieldId])).toBeUndefined();
      expect(finalX.fields[fixture.markerFieldId]).toBe(T1_X_MARKER);
      expect(finalY.fields[fixture.markerFieldId]).toBe(T1_Y_MARKER);
      expect(
        fixture.fillers.map(
          (record) => findRecord(finalRecords, record).fields[fixture.titleFieldId]
        )
      ).toEqual(fixture.fillers.map((_, index) => `Pending-lock filler updated ${index}`));

      const finalPhysical = await sql<{
        record_id: string;
        marker: string | null;
        children: unknown;
        parent: unknown;
        owner_id: string | null;
      }>`
        SELECT __id AS record_id,
          ${sql.ref(fixture.markerColumn)} AS marker,
          ${sql.ref(fixture.childrenColumn)} AS children,
          ${sql.ref(fixture.parentColumn)} AS parent,
          ${sql.ref(fixture.ownerColumn)} AS owner_id
        FROM ${sql.table(fixture.dbTableName)}
        WHERE __id IN (${fixture.parentA.id}, ${fixture.childX.id}, ${fixture.childY.id})
      `.execute(ctx.testContainer.db);
      const finalPhysicalById = new Map(finalPhysical.rows.map((row) => [row.record_id, row]));
      expect(finalPhysicalById.get(fixture.parentA.id)?.children).toBeNull();
      expect(finalPhysicalById.get(fixture.childX.id)).toMatchObject({
        marker: T1_X_MARKER,
        parent: null,
        owner_id: null,
      });
      expect(finalPhysicalById.get(fixture.childY.id)).toMatchObject({
        marker: T1_Y_MARKER,
        parent: null,
        owner_id: null,
      });
    } finally {
      await yGate?.release();
      await t1Gate?.release();
      await Promise.allSettled(requests);
      removeAttemptCounter?.();
      await dropInstrumentation(ctx, fixture, names);
    }
  }, 180_000);
});
