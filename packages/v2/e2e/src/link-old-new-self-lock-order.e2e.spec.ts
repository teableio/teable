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

type RecordRef = { id: string };
type ApiResult = { status: number; body: unknown };
type HeldGate = { pid: number; release(): Promise<void> };

type InstrumentationNames = {
  functionName: string;
  gateKey: string;
  gateTrigger: string;
  gateSequence: string;
  statementTrigger: string;
  statementSequence: string;
  requestTrigger: string;
  requestSequence: string;
  singleAttemptSequence: string;
  batchAttemptSequence: string;
};

type OneManyFixture = {
  parentTableId: string;
  childTableId: string;
  parentDbTableName: string;
  childDbTableName: string;
  parentTitleColumn: string;
  childValueColumn: string;
  parentTitleFieldId: string;
  childValueFieldId: string;
  childrenFieldId: string;
  parentFieldId: string;
  ownerColumn: string;
  parent: RecordRef;
  oldTarget: RecordRef;
  newTarget: RecordRef;
  fillers: RecordRef[];
};

type SelfLinkFixture = {
  tableId: string;
  dbTableName: string;
  titleFieldId: string;
  titleColumn: string;
  childrenFieldId: string;
  parentFieldId: string;
  ownerColumn: string;
  lowerRecord: RecordRef;
  higherRecord: RecordRef;
};

const advisoryKey = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

const post = async (
  ctx: SharedTestContext,
  endpoint: 'updateRecord' | 'updateRecords',
  payload: Record<string, unknown>
): Promise<ApiResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
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

const createRecordsInChunks = async (
  ctx: SharedTestContext,
  tableId: string,
  titleFieldId: string,
  count: number,
  prefix: string
): Promise<RecordRef[]> => {
  const records: RecordRef[] = [];
  for (let offset = 0; offset < count; offset += 250) {
    const size = Math.min(250, count - offset);
    records.push(
      ...(await ctx.createRecords(
        tableId,
        Array.from({ length: size }, (_, index) => ({
          fields: { [titleFieldId]: `${prefix} ${offset + index}` },
        }))
      ))
    );
  }
  return records;
};

const createOneManyFixture = async (ctx: SharedTestContext): Promise<OneManyFixture> => {
  const childTitleFieldId = `fld${getRandomString(16)}`;
  const childValueFieldId = `fld${getRandomString(16)}`;
  const children = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Old-new lock children ${getRandomString(8)}`,
    fields: [
      { id: childTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: childValueFieldId, name: 'Note', type: 'singleLineText' },
    ],
    views: [{ type: 'grid' }],
  });
  const childMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', children.id)
    .executeTakeFirstOrThrow();
  const childValueMeta = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('id', '=', childValueFieldId)
    .executeTakeFirstOrThrow();
  if (!childValueMeta.db_field_name) throw new Error('Missing child value column');

  const parentTitleFieldId = `fld${getRandomString(16)}`;
  const parents = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Old-new lock parents ${getRandomString(8)}`,
    fields: [{ id: parentTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const parentMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', parents.id)
    .executeTakeFirstOrThrow();
  const parentTitleMeta = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('id', '=', parentTitleFieldId)
    .executeTakeFirstOrThrow();
  if (!parentTitleMeta.db_field_name) throw new Error('Missing parent title column');

  const childrenFieldId = `fld${getRandomString(16)}`;
  const parentFieldId = `fld${getRandomString(16)}`;
  const ownerColumn = `__fk_${parentFieldId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: parents.id,
    field: {
      id: childrenFieldId,
      name: 'Children',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: children.id,
        lookupFieldId: childTitleFieldId,
        isOneWay: false,
        symmetricFieldId: parentFieldId,
        fkHostTableName: childMeta.db_table_name,
        selfKeyName: ownerColumn,
        foreignKeyName: '__id',
      },
    },
  });

  const [oldTarget, newTarget] = await ctx.createRecords(children.id, [
    { fields: { [childTitleFieldId]: 'Old target' } },
    { fields: { [childTitleFieldId]: 'New target' } },
  ]);
  if (!oldTarget || !newTarget) throw new Error('Missing old/new target records');
  const fillers = await createRecordsInChunks(
    ctx,
    children.id,
    childTitleFieldId,
    INTERNAL_BATCH_SIZE - 1,
    'Boundary filler'
  );
  const parent = await ctx.createRecord(parents.id, { [parentTitleFieldId]: 'Parent' });
  await ctx.updateRecord(parents.id, parent.id, {
    [childrenFieldId]: [{ id: oldTarget.id }],
  });
  await ctx.drainOutbox();

  return {
    parentTableId: parents.id,
    childTableId: children.id,
    parentDbTableName: parentMeta.db_table_name,
    childDbTableName: childMeta.db_table_name,
    parentTitleColumn: parentTitleMeta.db_field_name,
    childValueColumn: childValueMeta.db_field_name,
    parentTitleFieldId,
    childValueFieldId,
    childrenFieldId,
    parentFieldId,
    ownerColumn,
    parent,
    oldTarget,
    newTarget,
    fillers,
  };
};

const createSelfLinkFixture = async (ctx: SharedTestContext): Promise<SelfLinkFixture> => {
  const titleFieldId = `fld${getRandomString(16)}`;
  const table = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Self no-op lock ${getRandomString(8)}`,
    fields: [{ id: titleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const tableMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', table.id)
    .executeTakeFirstOrThrow();
  const titleMeta = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('id', '=', titleFieldId)
    .executeTakeFirstOrThrow();
  if (!titleMeta.db_field_name) throw new Error('Missing self-link title column');

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
    { fields: { [titleFieldId]: 'Node one' } },
    { fields: { [titleFieldId]: 'Node two' } },
  ]);
  const ordered = await sql<{ record_id: string }>`
    SELECT __id AS record_id
    FROM ${sql.table(tableMeta.db_table_name)}
    WHERE __id IN (${created[0]!.id}, ${created[1]!.id})
    ORDER BY __id
  `.execute(ctx.testContainer.db);
  if (ordered.rows.length !== 2) throw new Error('Missing ordered self-link records');

  return {
    tableId: table.id,
    dbTableName: tableMeta.db_table_name,
    titleFieldId,
    titleColumn: titleMeta.db_field_name,
    childrenFieldId,
    parentFieldId,
    ownerColumn,
    lowerRecord: { id: ordered.rows[0]!.record_id },
    higherRecord: { id: ordered.rows[1]!.record_id },
  };
};

const instrumentationNames = (scenario: string): InstrumentationNames => {
  const prefix = `t8242_${scenario}_${getRandomString(10).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    gateKey: `${prefix}:gate`,
    gateTrigger: `${prefix}_gate_trg`,
    gateSequence: `${prefix}_gate_seq`,
    statementTrigger: `${prefix}_stmt_trg`,
    statementSequence: `${prefix}_stmt_seq`,
    requestTrigger: `${prefix}_req_trg`,
    requestSequence: `${prefix}_req_seq`,
    singleAttemptSequence: `${prefix}_single_attempts`,
    batchAttemptSequence: `${prefix}_batch_attempts`,
  };
};

const addAttemptCounter = (
  ctx: SharedTestContext,
  tableIds: ReadonlyArray<string>,
  names: InstrumentationNames
): (() => void) => {
  const plugins = ctx.testContainer.container.resolve<IRecordWritePlugin[]>(
    v2CoreTokens.recordWritePlugins
  );
  const plugin: IRecordWritePlugin = {
    name: `${names.functionName}_attempt_counter`,
    enforce: 'pre',
    supports: (kind) =>
      kind === RecordWriteOperationKind.updateOne || kind === RecordWriteOperationKind.updateMany,
    beforePersist: async (context) => {
      if (!tableIds.includes(context.table.id().toString())) return ok(undefined);
      if (
        context.kind !== RecordWriteOperationKind.updateOne &&
        context.kind !== RecordWriteOperationKind.updateMany
      ) {
        return ok(undefined);
      }
      const transaction = getPostgresTransaction(context.executionContext, 'data');
      if (!context.isTransactionBound || !transaction) {
        throw new Error('Attempt counter requires an active data transaction');
      }
      const sequence =
        context.kind === RecordWriteOperationKind.updateOne
          ? names.singleAttemptSequence
          : names.batchAttemptSequence;
      // This real plugin hook runs in every UoW attempt before source SELECT locks.
      // A sequence increment survives rollback even if no UPDATE was reached.
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

const installInstrumentation = async (
  ctx: SharedTestContext,
  tableName: string,
  statementColumn: string | undefined,
  gateColumn: string | undefined,
  gateRecordId: string,
  names: InstrumentationNames,
  requestTableName?: string,
  requestColumn?: string
) => {
  await sql`CREATE SEQUENCE ${sql.id('public', names.gateSequence)}`.execute(ctx.testContainer.db);
  await sql`CREATE SEQUENCE ${sql.id('public', names.statementSequence)}`.execute(
    ctx.testContainer.db
  );
  for (const sequence of [names.singleAttemptSequence, names.batchAttemptSequence]) {
    await sql`CREATE SEQUENCE ${sql.id('public', sequence)}`.execute(ctx.testContainer.db);
  }
  if (requestTableName) {
    await sql`CREATE SEQUENCE ${sql.id('public', names.requestSequence)}`.execute(
      ctx.testContainer.db
    );
  }
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM nextval(TG_ARGV[0]::regclass);
      IF TG_LEVEL = 'ROW' THEN
        PERFORM pg_advisory_xact_lock(
          ('x' || substr(md5(TG_ARGV[1]), 1, 16))::bit(64)::bigint
        );
        RETURN NEW;
      END IF;
      RETURN NULL;
    END;
    $$
  `.execute(ctx.testContainer.db);

  const statementTarget = statementColumn ? sql`UPDATE OF ${sql.id(statementColumn)}` : sql`UPDATE`;
  await sql`
    CREATE TRIGGER ${sql.id(names.statementTrigger)}
    BEFORE ${statementTarget} ON ${sql.table(tableName)}
    FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.statementSequence}`)}
    )
  `.execute(ctx.testContainer.db);
  const gateTarget = gateColumn ? sql`UPDATE OF ${sql.id(gateColumn)}` : sql`UPDATE`;
  await sql`
    CREATE TRIGGER ${sql.id(names.gateTrigger)}
    AFTER ${gateTarget} ON ${sql.table(tableName)}
    FOR EACH ROW WHEN (NEW.__id = ${sql.lit(gateRecordId)})
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.gateSequence}`)}, ${sql.lit(names.gateKey)}
    )
  `.execute(ctx.testContainer.db);
  if (requestTableName && requestColumn) {
    await sql`
      CREATE TRIGGER ${sql.id(names.requestTrigger)}
      BEFORE UPDATE OF ${sql.id(requestColumn)} ON ${sql.table(requestTableName)}
      FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
        ${sql.lit(`public.${names.requestSequence}`)}
      )
    `.execute(ctx.testContainer.db);
  }
};

const dropInstrumentation = async (
  ctx: SharedTestContext,
  tableName: string,
  names: InstrumentationNames,
  requestTableName?: string
) => {
  for (const trigger of [names.gateTrigger, names.statementTrigger]) {
    await sql`DROP TRIGGER IF EXISTS ${sql.id(trigger)} ON ${sql.table(tableName)}`.execute(
      ctx.testContainer.db
    );
  }
  if (requestTableName) {
    await sql`DROP TRIGGER IF EXISTS ${sql.id(names.requestTrigger)} ON ${sql.table(
      requestTableName
    )}`.execute(ctx.testContainer.db);
  }
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
  const sequences = [
    names.gateSequence,
    names.statementSequence,
    names.singleAttemptSequence,
    names.batchAttemptSequence,
    ...(requestTableName ? [names.requestSequence] : []),
  ];
  for (const sequence of sequences) {
    await sql`DROP SEQUENCE IF EXISTS ${sql.id('public', sequence)}`.execute(ctx.testContainer.db);
  }
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
  return {
    pid: await acquired.promise,
    release: async () => {
      release.resolve();
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

const waitForSettledOrBlocked = async (
  ctx: SharedTestContext,
  blockerPid: number,
  settled: () => boolean,
  description: string
): Promise<{ state: 'settled' } | { state: 'blocked'; pid: number }> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (settled()) return { state: 'settled' };
    const result = await sql<{ pid: number }>`
      SELECT pid::int AS pid
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return { state: 'blocked', pid: result.rows[0]!.pid };
    expect(result.rows, `unexpected additional waiters: ${description}`).toHaveLength(0);
    await delay(20);
  }
  throw new Error(`PostgreSQL observed neither completion nor ${description}`);
};

const sequenceCalls = async (ctx: SharedTestContext, sequenceName: string): Promise<number> => {
  const result = await sql<{ last_value: string | number; is_called: boolean }>`
    SELECT last_value, is_called FROM ${sql.id('public', sequenceName)}
  `.execute(ctx.testContainer.db);
  const row = result.rows[0]!;
  return row.is_called ? Number(row.last_value) : 0;
};

describe('old/new target and self-link no-op lock ordering (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('cleans the old oneMany target before a crossed new-target wait without a deadlock retry', async () => {
    const fixture = await createOneManyFixture(ctx);
    const names = instrumentationNames('old_new');
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;
    let removeAttemptCounter: (() => void) | undefined;

    try {
      await installInstrumentation(
        ctx,
        fixture.childDbTableName,
        fixture.childValueColumn,
        fixture.childValueColumn,
        fixture.oldTarget.id,
        names,
        fixture.parentDbTableName,
        fixture.parentTitleColumn
      );
      removeAttemptCounter = addAttemptCounter(
        ctx,
        [fixture.parentTableId, fixture.childTableId],
        names
      );
      gate = await holdGate(ctx, names.gateKey);
      const valueUpdates = [fixture.oldTarget, ...fixture.fillers, fixture.newTarget].map(
        (record, index) => ({
          id: record.id,
          fields: { [fixture.childValueFieldId]: `Concurrent value ${index}` },
        })
      );
      expect(valueUpdates).toHaveLength(INTERNAL_BATCH_SIZE + 1);
      const valueRequest = post(ctx, 'updateRecords', {
        tableId: fixture.childTableId,
        records: valueUpdates,
      });
      requests.push(valueRequest);
      void Promise.allSettled(requests);
      const valuePid = await waitForBlockedBackend(ctx, gate.pid, 'first value batch gate');

      const linkRequest = post(ctx, 'updateRecord', {
        tableId: fixture.parentTableId,
        recordId: fixture.parent.id,
        fields: {
          [fixture.parentTitleFieldId]: 'Parent updated by link request',
          [fixture.childrenFieldId]: [{ id: fixture.newTarget.id }],
        },
      });
      requests.push(linkRequest);
      void Promise.allSettled(requests);
      const linkPid = await waitForBlockedBackend(
        ctx,
        valuePid,
        'link replacement waiting for the old target row'
      );
      expect(linkPid).not.toBe(valuePid);

      const locksBeforeRelease = await sql<{
        pid: number;
        lock_type: string;
        mode: string;
        granted: boolean;
        blockers: number[];
      }>`
        SELECT locks.pid::int AS pid,
          locks.locktype AS lock_type,
          locks.mode,
          locks.granted,
          pg_blocking_pids(locks.pid)::int[] AS blockers
        FROM pg_locks AS locks
        WHERE locks.pid IN (${valuePid}, ${linkPid})
          AND locks.locktype IN ('advisory', 'transactionid', 'tuple')
        ORDER BY locks.pid, locks.locktype, locks.granted
      `.execute(ctx.testContainer.db);

      await gate.release();
      const results = await Promise.all(requests);
      const attempts = {
        valueStatements: await sequenceCalls(ctx, names.statementSequence),
        valueGateRows: await sequenceCalls(ctx, names.gateSequence),
        linkStatements: await sequenceCalls(ctx, names.requestSequence),
        singleTransactions: await sequenceCalls(ctx, names.singleAttemptSequence),
        batchTransactions: await sequenceCalls(ctx, names.batchAttemptSequence),
      };
      const evidence = JSON.stringify({
        results,
        attempts,
        locksBeforeRelease: locksBeforeRelease.rows,
      });

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
      expect.soft(attempts, `deadlock transaction retry detected: ${evidence}`).toEqual({
        valueStatements: 2,
        valueGateRows: 1,
        linkStatements: 1,
        singleTransactions: 1,
        batchTransactions: 1,
      });

      await ctx.drainOutbox();
      const parent = findRecord(await ctx.listRecords(fixture.parentTableId), fixture.parent);
      expect(parent.fields[fixture.parentTitleFieldId]).toBe('Parent updated by link request');
      expect(linkIds(parent.fields[fixture.childrenFieldId])).toEqual([fixture.newTarget.id]);
      const children = await ctx.listRecords(fixture.childTableId);
      expect(
        singleLinkId(findRecord(children, fixture.oldTarget).fields[fixture.parentFieldId])
      ).toBeUndefined();
      expect(
        singleLinkId(findRecord(children, fixture.newTarget).fields[fixture.parentFieldId])
      ).toBe(fixture.parent.id);
      const physicalOwners = await sql<{ record_id: string; owner_id: string | null }>`
        SELECT __id AS record_id, ${sql.id(fixture.ownerColumn)} AS owner_id
        FROM ${sql.table(fixture.childDbTableName)}
        WHERE __id IN (${fixture.oldTarget.id}, ${fixture.newTarget.id})
      `.execute(ctx.testContainer.db);
      expect(new Map(physicalOwners.rows.map((row) => [row.record_id, row.owner_id]))).toEqual(
        new Map<string, string | null>([
          [fixture.oldTarget.id, null],
          [fixture.newTarget.id, fixture.parent.id],
        ])
      );
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      removeAttemptCounter?.();
      await dropInstrumentation(ctx, fixture.childDbTableName, names, fixture.parentDbTableName);
    }
  }, 120_000);

  it('does not let self-link no-op source locks invert the target row order or trigger a retry', async () => {
    const fixture = await createSelfLinkFixture(ctx);
    const names = instrumentationNames('self_noop');
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;
    let removeAttemptCounter: (() => void) | undefined;

    try {
      await installInstrumentation(
        ctx,
        fixture.dbTableName,
        fixture.ownerColumn,
        fixture.titleColumn,
        fixture.higherRecord.id,
        names
      );
      removeAttemptCounter = addAttemptCounter(ctx, [fixture.tableId], names);
      gate = await holdGate(ctx, names.gateKey);

      const linkRequest = post(ctx, 'updateRecord', {
        tableId: fixture.tableId,
        recordId: fixture.higherRecord.id,
        fields: {
          [fixture.titleFieldId]: 'Higher node updated by link request',
          [fixture.childrenFieldId]: [{ id: fixture.lowerRecord.id }],
        },
      });
      requests.push(linkRequest);
      void Promise.allSettled(requests);
      const linkPid = await waitForBlockedBackend(ctx, gate.pid, 'self-link source-row gate');

      let noOpSettled = false;
      const noOpRequest = post(ctx, 'updateRecords', {
        tableId: fixture.tableId,
        records: [
          { id: fixture.lowerRecord.id, fields: { [fixture.parentFieldId]: null } },
          { id: fixture.higherRecord.id, fields: { [fixture.parentFieldId]: null } },
        ],
      });
      void noOpRequest.then(
        () => {
          noOpSettled = true;
        },
        () => {
          noOpSettled = true;
        }
      );
      requests.push(noOpRequest);
      void Promise.allSettled(requests);
      const noOpBoundary = await waitForSettledOrBlocked(
        ctx,
        linkPid,
        () => noOpSettled,
        'no-op batch waiting for the higher source row'
      );

      await gate.release();
      const results = await Promise.all(requests);
      const attempts = {
        ownerStatements: await sequenceCalls(ctx, names.statementSequence),
        linkSourceRows: await sequenceCalls(ctx, names.gateSequence),
        singleTransactions: await sequenceCalls(ctx, names.singleAttemptSequence),
        batchTransactions: await sequenceCalls(ctx, names.batchAttemptSequence),
      };
      const evidence = JSON.stringify({ results, attempts, noOpBoundary });

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
      // Count attempts before source SELECT locks, not only UPDATE statements:
      // the no-op transaction can be a deadlock victim before executing an UPDATE.
      expect.soft(attempts, `deadlock transaction retry detected: ${evidence}`).toMatchObject({
        linkSourceRows: 1,
        singleTransactions: 1,
        batchTransactions: 1,
      });

      await ctx.drainOutbox();
      const records = await ctx.listRecords(fixture.tableId);
      const lower = findRecord(records, fixture.lowerRecord);
      const higher = findRecord(records, fixture.higherRecord);
      expect(higher.fields[fixture.titleFieldId]).toBe('Higher node updated by link request');
      // A unified source+target lock may serialize the no-op request behind the
      // link request. In that order its null intent correctly clears the new link;
      // if it completed at the gate, the later link request must win instead.
      const expectedOwner = noOpBoundary.state === 'settled' ? fixture.higherRecord.id : null;
      expect(singleLinkId(lower.fields[fixture.parentFieldId]) ?? null).toBe(expectedOwner);
      expect(linkIds(higher.fields[fixture.childrenFieldId])).toEqual(
        expectedOwner ? [fixture.lowerRecord.id] : []
      );
      expect(singleLinkId(higher.fields[fixture.parentFieldId])).toBeUndefined();
      expect(linkIds(lower.fields[fixture.childrenFieldId])).toEqual([]);

      const physicalOwners = await sql<{ record_id: string; owner_id: string | null }>`
        SELECT __id AS record_id, ${sql.id(fixture.ownerColumn)} AS owner_id
        FROM ${sql.table(fixture.dbTableName)}
        WHERE __id IN (${fixture.lowerRecord.id}, ${fixture.higherRecord.id})
      `.execute(ctx.testContainer.db);
      expect(new Map(physicalOwners.rows.map((row) => [row.record_id, row.owner_id]))).toEqual(
        new Map<string, string | null>([
          [fixture.lowerRecord.id, expectedOwner],
          [fixture.higherRecord.id, null],
        ])
      );
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      removeAttemptCounter?.();
      await dropInstrumentation(ctx, fixture.dbTableName, names);
    }
  }, 60_000);
});
