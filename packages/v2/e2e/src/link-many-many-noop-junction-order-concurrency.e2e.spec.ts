/* eslint-disable @typescript-eslint/naming-convention */
import { setTimeout as delay } from 'node:timers/promises';
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const WAIT_TIMEOUT_MS = 15_000;
const T1_MARKER = 'Q changed by T1';

type RecordRef = { id: string };
type ApiResult = { status: number; body: unknown };
type HeldGate = { pid: number; release(): Promise<void> };
type LinkValue = { id: string; title: string };

type LinkOptions = {
  fkHostTableName?: string;
  selfKeyName?: string;
  foreignKeyName?: string;
};

type Fixture = {
  sourceTableId: string;
  sourceDbTableName: string;
  sourceRelationOid: number;
  markerFieldId: string;
  markerColumn: string;
  linkFieldId: string;
  linkCacheColumn: string;
  junctionTableName: string;
  sourceKeyColumn: string;
  targetKeyColumn: string;
  sourceP: RecordRef;
  sourceQ: RecordRef;
  targetX: RecordRef;
  targetY: RecordRef;
};

type Instrumentation = {
  functionName: string;
  triggerName: string;
  gateKey: string;
};

const advisoryKey = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

const linkIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('id' in item)) return [];
    return typeof item.id === 'string' ? [item.id] : [];
  });
};

const postUpdateRecord = async (
  ctx: SharedTestContext,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<ApiResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, recordId, fields }),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
};

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

const createFixture = async (ctx: SharedTestContext): Promise<Fixture> => {
  const targetTitleFieldId = `fld${getRandomString(16)}`;
  const targets = await ctx.createTable({
    baseId: ctx.baseId,
    name: `No-op junction targets ${getRandomString(8)}`,
    fields: [{ id: targetTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const [targetX, targetY] = await ctx.createRecords(targets.id, [
    { fields: { [targetTitleFieldId]: 'X' } },
    { fields: { [targetTitleFieldId]: 'Y' } },
  ]);
  if (!targetX || !targetY) throw new Error('Missing X/Y target records');

  const sourceTitleFieldId = `fld${getRandomString(16)}`;
  const markerFieldId = `fld${getRandomString(16)}`;
  const linkFieldId = `fld${getRandomString(16)}`;
  const sources = await ctx.createTable({
    baseId: ctx.baseId,
    name: `No-op junction sources ${getRandomString(8)}`,
    fields: [
      { id: sourceTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: markerFieldId, name: 'Marker', type: 'singleLineText' },
      {
        id: linkFieldId,
        name: 'Targets',
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: targets.id,
          lookupFieldId: targetTitleFieldId,
        },
      },
    ],
    views: [{ type: 'grid' }],
  });

  const sourceMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', sources.id)
    .executeTakeFirstOrThrow();
  const fieldMeta = await ctx.testContainer.db
    .selectFrom('field')
    .select(['id', 'db_field_name'])
    .where('id', 'in', [markerFieldId, linkFieldId])
    .execute();
  const dbColumnByFieldId = new Map(fieldMeta.map((field) => [field.id, field.db_field_name]));
  const markerColumn = dbColumnByFieldId.get(markerFieldId);
  const linkCacheColumn = dbColumnByFieldId.get(linkFieldId);
  if (!markerColumn || !linkCacheColumn) throw new Error('Missing source database columns');

  const sourceTable = await ctx.getTableById(sources.id);
  const linkField = sourceTable.fields.find((field) => field.id === linkFieldId);
  if (!linkField) throw new Error('Missing source link field');
  const options = linkField.options as LinkOptions | undefined;
  if (!options?.fkHostTableName || !options.selfKeyName || !options.foreignKeyName) {
    throw new Error('Many-many link storage metadata is incomplete');
  }

  const [sourceP, sourceQ] = await ctx.createRecords(sources.id, [
    {
      fields: {
        [sourceTitleFieldId]: 'P',
        [markerFieldId]: 'P initial',
        [linkFieldId]: [
          { id: targetX.id, title: 'X' },
          { id: targetY.id, title: 'Y' },
        ],
      },
    },
    {
      fields: {
        [sourceTitleFieldId]: 'Q',
        [markerFieldId]: 'Q initial',
      },
    },
  ]);
  if (!sourceP || !sourceQ) throw new Error('Missing P/Q source records');
  await ctx.drainOutbox();

  const sourceRelation = await sql<{ relation_oid: number }>`
    SELECT tableoid::int AS relation_oid
    FROM ${sql.table(sourceMeta.db_table_name)}
    WHERE __id = ${sourceP.id}
  `.execute(ctx.testContainer.db);
  const sourceRelationOid = sourceRelation.rows[0]?.relation_oid;
  if (sourceRelationOid === undefined) throw new Error('Missing source relation OID');

  return {
    sourceTableId: sources.id,
    sourceDbTableName: sourceMeta.db_table_name,
    sourceRelationOid,
    markerFieldId,
    markerColumn,
    linkFieldId,
    linkCacheColumn,
    junctionTableName: options.fkHostTableName,
    sourceKeyColumn: options.selfKeyName,
    targetKeyColumn: options.foreignKeyName,
    sourceP,
    sourceQ,
    targetX,
    targetY,
  };
};

const instrumentationNames = (): Instrumentation => {
  const prefix = `t8242_noop_junction_${getRandomString(8).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    triggerName: `${prefix}_trg`,
    gateKey: `${prefix}:after-main-update`,
  };
};

const installAfterMainUpdateGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM gate_new_rows AS new_row
        JOIN gate_old_rows AS old_row USING (__id)
        WHERE new_row.__id = TG_ARGV[1]
          AND to_jsonb(new_row) ->> TG_ARGV[2] = TG_ARGV[3]
          AND to_jsonb(old_row) ->> TG_ARGV[2] IS DISTINCT FROM TG_ARGV[3]
      ) THEN
        RETURN NULL;
      END IF;
      IF EXISTS (SELECT 1 FROM gate_new_rows WHERE __id = TG_ARGV[4]) THEN
        RAISE EXCEPTION 'Invalid no-op fixture: P was physically updated by T1';
      END IF;
      PERFORM pg_advisory_xact_lock(
        ('x' || substr(md5(TG_ARGV[0]), 1, 16))::bit(64)::bigint
      );
      RETURN NULL;
    END;
    $$
  `.execute(ctx.testContainer.db);
  // Gate only the statement that actually changes Q's marker. Transition tables
  // also prove P was filtered from the main UPDATE, rather than silently holding
  // its row lock because an ID-only payload dropped the cached link titles.
  // An UPDATE OF trigger alone could also gate an unrelated full-row UPDATE.
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    AFTER UPDATE
    ON ${sql.table(fixture.sourceDbTableName)}
    REFERENCING OLD TABLE AS gate_old_rows NEW TABLE AS gate_new_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(names.gateKey)},
      ${sql.lit(fixture.sourceQ.id)},
      ${sql.lit(fixture.markerColumn)},
      ${sql.lit(T1_MARKER)},
      ${sql.lit(fixture.sourceP.id)}
    )
  `.execute(ctx.testContainer.db);
};

const dropAfterMainUpdateGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await sql`
    DROP TRIGGER IF EXISTS ${sql.id(names.triggerName)}
    ON ${sql.table(fixture.sourceDbTableName)}
  `.execute(ctx.testContainer.db);
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
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

const waitForT1AtGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  blockerPid: number
): Promise<number> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await sql<{ pid: number }>`
      SELECT activity.pid::int AS pid
      FROM pg_stat_activity AS activity
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND activity.state = 'active'
        AND activity.wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(activity.pid))
        AND EXISTS (
          SELECT 1
          FROM pg_locks AS relation_lock
          WHERE relation_lock.pid = activity.pid
            AND relation_lock.relation = ${fixture.sourceRelationOid}::oid
        )
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return result.rows[0]!.pid;
    expect(result.rows, 'only T1 should wait on its unique post-UPDATE gate').toHaveLength(0);
    await delay(20);
  }
  throw new Error('PostgreSQL did not observe T1 blocked after its main batch UPDATE');
};

const waitForT2Commit = async (
  ctx: SharedTestContext,
  request: Promise<ApiResult>,
  t1Pid: number,
  gatePid: number
): Promise<ApiResult> => {
  const timeout = new AbortController();
  try {
    return await Promise.race([
      request,
      delay(WAIT_TIMEOUT_MS, undefined, { signal: timeout.signal }).then(async () => {
        const waiters = await sql<{
          pid: number;
          wait_event_type: string | null;
          wait_event: string | null;
          blockers: number[];
          query: string;
        }>`
          SELECT pid::int AS pid, wait_event_type, wait_event,
            pg_blocking_pids(pid)::int[] AS blockers, left(query, 1500) AS query
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND (
              pid = ${t1Pid}
              OR ${t1Pid} = ANY(pg_blocking_pids(pid))
              OR ${gatePid} = ANY(pg_blocking_pids(pid))
            )
          ORDER BY pid
        `.execute(ctx.testContainer.db);
        throw new Error(
          `T2 did not commit before the T1 gate was released: ${JSON.stringify(waiters.rows)}`
        );
      }),
    ]);
  } finally {
    timeout.abort();
  }
};

const readCachedLinks = async (ctx: SharedTestContext, fixture: Fixture): Promise<unknown> => {
  const result = await sql<{ cached_value: unknown }>`
    SELECT ${sql.id(fixture.linkCacheColumn)} AS cached_value
    FROM ${sql.table(fixture.sourceDbTableName)}
    WHERE __id = ${fixture.sourceP.id}
  `.execute(ctx.testContainer.db);
  return result.rows[0]?.cached_value;
};

const readOrderedJunctionIds = async (
  ctx: SharedTestContext,
  fixture: Fixture
): Promise<string[]> => {
  const result = await sql<{ target_id: string }>`
    SELECT ${sql.id(fixture.targetKeyColumn)} AS target_id
    FROM ${sql.table(fixture.junctionTableName)}
    WHERE ${sql.id(fixture.sourceKeyColumn)} = ${fixture.sourceP.id}
    ORDER BY ${sql.id('__order')}, __id
  `.execute(ctx.testContainer.db);
  return result.rows.map(({ target_id }) => target_id);
};

const expectPersistedOrder = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  expectedLinks: LinkValue[]
): Promise<void> => {
  expect(await readCachedLinks(ctx, fixture)).toEqual(expectedLinks);
  expect(await readOrderedJunctionIds(ctx, fixture)).toEqual(expectedLinks.map(({ id }) => id));
};

describe('manyMany no-op junction ordering after a concurrent commit (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('does not let a no-op mixed batch overwrite the link order committed while it is between main and relation statements', async () => {
    const fixture = await createFixture(ctx);
    const names = instrumentationNames();
    const initialLinks: LinkValue[] = [
      { id: fixture.targetX.id, title: 'X' },
      { id: fixture.targetY.id, title: 'Y' },
    ];
    const reorderedLinks: LinkValue[] = [
      { id: fixture.targetY.id, title: 'Y' },
      { id: fixture.targetX.id, title: 'X' },
    ];
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await expectPersistedOrder(ctx, fixture, initialLinks);
      await installAfterMainUpdateGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.gateKey);

      const t1 = postUpdateRecords(ctx, fixture.sourceTableId, [
        {
          id: fixture.sourceP.id,
          fields: {
            [fixture.linkFieldId]: initialLinks,
          },
        },
        {
          id: fixture.sourceQ.id,
          fields: { [fixture.markerFieldId]: T1_MARKER },
        },
      ]);
      requests.push(t1);
      void Promise.allSettled(requests);
      const t1Pid = await Promise.race([
        waitForT1AtGate(ctx, fixture, gate.pid),
        t1.then((result) => {
          throw new Error(
            `T1 finished before reaching the post-UPDATE gate: ${JSON.stringify(result)}`
          );
        }),
      ]);

      const t2 = postUpdateRecord(ctx, fixture.sourceTableId, fixture.sourceP.id, {
        [fixture.linkFieldId]: reorderedLinks,
      });
      requests.push(t2);
      void Promise.allSettled(requests);
      // Bound this wait so a real T1-held lock is reported with PostgreSQL evidence,
      // then the finally block releases the gate rather than hanging test cleanup.
      const t2Result = await waitForT2Commit(ctx, t2, t1Pid, gate.pid);
      expect(t2Result.status, JSON.stringify(t2Result.body)).toBe(200);
      expect(t2Result.body).toEqual(expect.objectContaining({ ok: true }));

      // These reads use a separate pool checkout, proving T2 committed while T1
      // remains inside the AFTER-main-UPDATE trigger and before any T1 relation DML.
      await expectPersistedOrder(ctx, fixture, reorderedLinks);

      await gate.release();
      const t1Result = await t1;
      expect(t1Result.status, JSON.stringify(t1Result.body)).toBe(200);
      expect(t1Result.body).toEqual(expect.objectContaining({ ok: true }));

      await ctx.drainOutbox();
      await expectPersistedOrder(ctx, fixture, reorderedLinks);
      const sourceRecords = await ctx.listRecords(fixture.sourceTableId);
      const sourceP = sourceRecords.find(({ id }) => id === fixture.sourceP.id);
      const sourceQ = sourceRecords.find(({ id }) => id === fixture.sourceQ.id);
      expect(linkIds(sourceP?.fields[fixture.linkFieldId])).toEqual([
        fixture.targetY.id,
        fixture.targetX.id,
      ]);
      expect(sourceQ?.fields[fixture.markerFieldId]).toBe(T1_MARKER);
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropAfterMainUpdateGate(ctx, fixture, names);
    }
  }, 60_000);
});
