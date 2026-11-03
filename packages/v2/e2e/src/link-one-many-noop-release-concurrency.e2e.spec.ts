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
  targetB: RecordRef;
  targetC: RecordRef;
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

const findRecord = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  record: RecordRef
) => {
  const found = records.find(({ id }) => id === record.id);
  if (!found) throw new Error(`Missing record ${record.id}`);
  return found;
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
    name: `No-op release targets ${getRandomString(8)}`,
    fields: [{ id: targetTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const [targetB, targetC] = await ctx.createRecords(targets.id, [
    { fields: { [targetTitleFieldId]: 'B' } },
    { fields: { [targetTitleFieldId]: 'C' } },
  ]);
  if (!targetB || !targetC) throw new Error('Missing B/C target records');

  const sourceTitleFieldId = `fld${getRandomString(16)}`;
  const markerFieldId = `fld${getRandomString(16)}`;
  const linkFieldId = `fld${getRandomString(16)}`;
  const sources = await ctx.createTable({
    baseId: ctx.baseId,
    name: `No-op release sources ${getRandomString(8)}`,
    fields: [
      { id: sourceTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: markerFieldId, name: 'Marker', type: 'singleLineText' },
      {
        id: linkFieldId,
        name: 'Targets',
        type: 'link',
        options: {
          relationship: 'oneMany',
          foreignTableId: targets.id,
          lookupFieldId: targetTitleFieldId,
          isOneWay: true,
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
  const sourceDbTableName = sourceMeta.db_table_name;

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
    throw new Error('One-way one-many junction metadata is incomplete');
  }

  const [sourceP, sourceQ] = await ctx.createRecords(sources.id, [
    {
      fields: {
        [sourceTitleFieldId]: 'P',
        [markerFieldId]: 'P initial',
        [linkFieldId]: [{ id: targetB.id, title: 'B' }],
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
    FROM ${sql.table(sourceDbTableName)}
    WHERE __id = ${sourceP.id}
  `.execute(ctx.testContainer.db);
  const sourceRelationOid = sourceRelation.rows[0]?.relation_oid;
  if (sourceRelationOid === undefined) throw new Error('Missing source relation OID');

  return {
    sourceTableId: sources.id,
    sourceDbTableName,
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
    targetB,
    targetC,
  };
};

const instrumentationNames = (): Instrumentation => {
  const prefix = `t8242_noop_release_${getRandomString(8).toLowerCase()}`;
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
  // its row lock because an ID-only payload dropped the cached link title.
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

const readSourceCaches = async (ctx: SharedTestContext, fixture: Fixture) => {
  const result = await sql<{ source_id: string; cached_value: unknown }>`
    SELECT __id AS source_id, ${sql.id(fixture.linkCacheColumn)} AS cached_value
    FROM ${sql.table(fixture.sourceDbTableName)}
    WHERE __id IN (${fixture.sourceP.id}, ${fixture.sourceQ.id})
    ORDER BY __id
  `.execute(ctx.testContainer.db);
  return new Map(result.rows.map(({ source_id, cached_value }) => [source_id, cached_value]));
};

const readJunctionRows = async (ctx: SharedTestContext, fixture: Fixture) => {
  const result = await sql<{ owner_id: string; target_id: string }>`
    SELECT
      ${sql.id(fixture.sourceKeyColumn)} AS owner_id,
      ${sql.id(fixture.targetKeyColumn)} AS target_id
    FROM ${sql.table(fixture.junctionTableName)}
    WHERE ${sql.id(fixture.targetKeyColumn)} IN (${fixture.targetB.id}, ${fixture.targetC.id})
  `.execute(ctx.testContainer.db);
  return result.rows.sort((left, right) =>
    left.target_id === right.target_id
      ? left.owner_id.localeCompare(right.owner_id)
      : left.target_id.localeCompare(right.target_id)
  );
};

const expectConsistentState = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  expected: { p: string[]; q: string[]; bOwner: string | null; cOwner: string | null }
): Promise<void> => {
  const sourceCaches = await readSourceCaches(ctx, fixture);
  const titleByTargetId = new Map([
    [fixture.targetB.id, 'B'],
    [fixture.targetC.id, 'C'],
  ]);
  expect(sourceCaches.get(fixture.sourceP.id)).toEqual(
    expected.p.map((id) => ({ id, title: titleByTargetId.get(id) }))
  );
  expect(linkIds(sourceCaches.get(fixture.sourceQ.id))).toEqual(expected.q);

  const expectedJunctionRows = [
    ...(expected.bOwner ? [{ owner_id: expected.bOwner, target_id: fixture.targetB.id }] : []),
    ...(expected.cOwner ? [{ owner_id: expected.cOwner, target_id: fixture.targetC.id }] : []),
  ].sort((left, right) =>
    left.target_id === right.target_id
      ? left.owner_id.localeCompare(right.owner_id)
      : left.target_id.localeCompare(right.target_id)
  );
  expect(await readJunctionRows(ctx, fixture)).toEqual(expectedJunctionRows);

  const sources = await ctx.listRecords(fixture.sourceTableId);
  expect(linkIds(findRecord(sources, fixture.sourceP).fields[fixture.linkFieldId])).toEqual(
    expected.p
  );
  expect(linkIds(findRecord(sources, fixture.sourceQ).fields[fixture.linkFieldId])).toEqual(
    expected.q
  );
};

describe('oneMany no-op release cannot enable a stale batch claim (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('rejects and rolls back T1 instead of using its unexecuted P no-op to release C for Q', async () => {
    const fixture = await createFixture(ctx);
    const names = instrumentationNames();
    const initialPLinks: LinkValue[] = [{ id: fixture.targetB.id, title: 'B' }];
    const claimedCLinks: LinkValue[] = [{ id: fixture.targetC.id, title: 'C' }];
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await expectConsistentState(ctx, fixture, {
        p: [fixture.targetB.id],
        q: [],
        bOwner: fixture.sourceP.id,
        cOwner: null,
      });
      await installAfterMainUpdateGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.gateKey);

      const t1 = postUpdateRecords(ctx, fixture.sourceTableId, [
        {
          id: fixture.sourceP.id,
          fields: { [fixture.linkFieldId]: initialPLinks },
        },
        {
          id: fixture.sourceQ.id,
          fields: {
            [fixture.markerFieldId]: T1_MARKER,
            [fixture.linkFieldId]: claimedCLinks,
          },
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
        [fixture.linkFieldId]: claimedCLinks,
      });
      requests.push(t2);
      void Promise.allSettled(requests);
      // Bound this wait so a real T1-held lock is reported with PostgreSQL evidence,
      // then finally releases the gate instead of hanging shared-context cleanup.
      const t2Result = await waitForT2Commit(ctx, t2, t1Pid, gate.pid);
      expect(t2Result.status, JSON.stringify(t2Result.body)).toBe(200);
      expect(t2Result.body).toEqual(expect.objectContaining({ ok: true }));

      // A separate checkout sees T2's commit while T1 is still between its main
      // UPDATE and relation DML. C belongs to P and B has been released.
      await expectConsistentState(ctx, fixture, {
        p: [fixture.targetC.id],
        q: [],
        bOwner: null,
        cOwner: fixture.sourceP.id,
      });

      await gate.release();
      const t1Result = await t1;
      expect(t1Result.status).toBeGreaterThanOrEqual(400);
      expect(t1Result.status).toBeLessThan(500);
      expect(JSON.stringify(t1Result.body).toLowerCase()).toMatch(
        /already|conflict|duplicate|link|validation/
      );

      await ctx.drainOutbox();
      await expectConsistentState(ctx, fixture, {
        p: [fixture.targetC.id],
        q: [],
        bOwner: null,
        cOwner: fixture.sourceP.id,
      });
      const sources = await ctx.listRecords(fixture.sourceTableId);
      expect(findRecord(sources, fixture.sourceQ).fields[fixture.markerFieldId]).toBe('Q initial');
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropAfterMainUpdateGate(ctx, fixture, names);
    }
  }, 60_000);
});
