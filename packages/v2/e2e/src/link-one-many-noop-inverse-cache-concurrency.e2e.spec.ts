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
type HeldGate = { pid: number; automaticallyReleased: boolean; release(): Promise<void> };
type Fixture = {
  parentTableId: string;
  childTableId: string;
  parentDbTableName: string;
  childDbTableName: string;
  parentRelationOid: number;
  childrenFieldId: string;
  parentFieldId: string;
  markerFieldId: string;
  childrenColumn: string;
  parentColumn: string;
  ownerColumn: string;
  markerColumn: string;
  p: RecordRef;
  q: RecordRef;
  x: RecordRef;
  y: RecordRef;
};
type Instrumentation = { functionName: string; triggerName: string; gateKey: string };

const advisoryKey = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

const tableDbName = async (ctx: SharedTestContext, tableId: string): Promise<string> => {
  const row = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', tableId)
    .executeTakeFirstOrThrow();
  return row.db_table_name;
};

const fieldDbName = async (ctx: SharedTestContext, fieldId: string): Promise<string> => {
  const row = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('id', '=', fieldId)
    .where('deleted_time', 'is', null)
    .executeTakeFirstOrThrow();
  if (!row.db_field_name) throw new Error(`Missing database column for ${fieldId}`);
  return row.db_field_name;
};

const createFixture = async (ctx: SharedTestContext): Promise<Fixture> => {
  const childTitleFieldId = `fld${getRandomString(16)}`;
  const children = await ctx.createTable({
    baseId: ctx.baseId,
    name: `No-op inverse race children ${getRandomString(8)}`,
    fields: [{ id: childTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const childDbTableName = await tableDbName(ctx, children.id);
  const parentTitleFieldId = `fld${getRandomString(16)}`;
  const markerFieldId = `fld${getRandomString(16)}`;
  const parents = await ctx.createTable({
    baseId: ctx.baseId,
    name: `No-op inverse race parents ${getRandomString(8)}`,
    fields: [
      { id: parentTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: markerFieldId, name: 'Marker', type: 'singleLineText' },
    ],
    views: [{ type: 'grid' }],
  });
  const parentDbTableName = await tableDbName(ctx, parents.id);
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
        fkHostTableName: childDbTableName,
        selfKeyName: ownerColumn,
        foreignKeyName: '__id',
      },
    },
  });
  const [x, y] = await ctx.createRecords(children.id, [
    { fields: { [childTitleFieldId]: 'X' } },
    { fields: { [childTitleFieldId]: 'Y' } },
  ]);
  if (!x || !y) throw new Error('Missing X/Y children');
  const [p, q] = await ctx.createRecords(parents.id, [
    {
      fields: {
        [parentTitleFieldId]: 'P',
        [childrenFieldId]: [{ id: x.id, title: 'X' }],
      },
    },
    { fields: { [parentTitleFieldId]: 'Q', [markerFieldId]: 'Q initial' } },
  ]);
  if (!p || !q) throw new Error('Missing P/Q parents');
  await ctx.drainOutbox();
  const relation = await sql<{ relation_oid: number }>`
    SELECT tableoid::int AS relation_oid
    FROM ${sql.table(parentDbTableName)} WHERE __id = ${p.id}
  `.execute(ctx.testContainer.db);
  const parentRelationOid = relation.rows[0]?.relation_oid;
  if (parentRelationOid === undefined) throw new Error('Missing parent relation OID');
  return {
    parentTableId: parents.id,
    childTableId: children.id,
    parentDbTableName,
    childDbTableName,
    parentRelationOid,
    childrenFieldId,
    parentFieldId,
    markerFieldId,
    childrenColumn: await fieldDbName(ctx, childrenFieldId),
    parentColumn: await fieldDbName(ctx, parentFieldId),
    ownerColumn,
    markerColumn: await fieldDbName(ctx, markerFieldId),
    p,
    q,
    x,
    y,
  };
};

const postUpdate = async (
  ctx: SharedTestContext,
  operation: 'updateRecord' | 'updateRecords',
  body: Record<string, unknown>
): Promise<ApiResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
};

const installGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM gate_new_rows AS new_row
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
  // Transition tables prove the mixed batch really omitted P from its main SQL.
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)} AFTER UPDATE
    ON ${sql.table(fixture.parentDbTableName)}
    REFERENCING OLD TABLE AS gate_old_rows NEW TABLE AS gate_new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(names.gateKey)}, ${sql.lit(fixture.q.id)},
      ${sql.lit(fixture.markerColumn)}, ${sql.lit(T1_MARKER)}, ${sql.lit(fixture.p.id)}
    )
  `.execute(ctx.testContainer.db);
};

const dropGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await sql`
    DROP TRIGGER IF EXISTS ${sql.id(names.triggerName)}
    ON ${sql.table(fixture.parentDbTableName)}
  `.execute(ctx.testContainer.db);
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
};

const holdGate = async (ctx: SharedTestContext, key: string): Promise<HeldGate> => {
  const acquired = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  // A failed assertion or abandoned request must not leave a shared PG checkout blocked.
  let automaticallyReleased = false;
  const timer = setTimeout(() => {
    automaticallyReleased = true;
    release.resolve();
  }, WAIT_TIMEOUT_MS * 3);
  const transaction = ctx.testContainer.db.transaction().execute(async (trx) => {
    const result = await sql<{ pid: number }>`
      SELECT pg_backend_pid()::int AS pid, pg_advisory_xact_lock(${advisoryKey(key)})
    `.execute(trx);
    acquired.resolve(result.rows[0]!.pid);
    await release.promise;
  });
  void transaction.catch((error: unknown) => acquired.reject(error));
  try {
    const pid = await acquired.promise;
    return {
      pid,
      get automaticallyReleased() {
        return automaticallyReleased;
      },
      release: async () => {
        clearTimeout(timer);
        release.resolve();
        await transaction;
      },
    };
  } catch (error) {
    clearTimeout(timer);
    release.resolve();
    throw error;
  }
};

const waitForT1AtGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  blockerPid: number
): Promise<number> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await sql<{ pid: number }>`
      SELECT activity.pid::int AS pid FROM pg_stat_activity AS activity
      WHERE activity.datname = current_database()
        AND activity.state = 'active' AND activity.wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(activity.pid))
        AND EXISTS (
          SELECT 1 FROM pg_locks AS relation_lock
          WHERE relation_lock.pid = activity.pid
            AND relation_lock.relation = ${fixture.parentRelationOid}::oid
        )
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return result.rows[0]!.pid;
    expect(result.rows, 'only T1 should wait on the unique post-main-SQL gate').toHaveLength(0);
    await delay(20);
  }
  throw new Error('T1 did not reach the gate after its main batch UPDATE');
};

const waitForT2Commit = async (
  ctx: SharedTestContext,
  request: Promise<ApiResult>,
  t1Pid: number
): Promise<ApiResult> => {
  const timeout = new AbortController();
  try {
    return await Promise.race([
      request,
      delay(WAIT_TIMEOUT_MS, undefined, { signal: timeout.signal }).then(async () => {
        const waiters = await sql<{ pid: number; blockers: number[]; query: string }>`
          SELECT pid::int AS pid, pg_blocking_pids(pid)::int[] AS blockers,
            left(query, 1500) AS query
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND (pid = ${t1Pid} OR ${t1Pid} = ANY(pg_blocking_pids(pid)))
          ORDER BY pid
        `.execute(ctx.testContainer.db);
        throw new Error(`T2 did not commit before releasing T1: ${JSON.stringify(waiters.rows)}`);
      }),
    ]);
  } finally {
    timeout.abort();
  }
};

const expectPhysicalOwners = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  expected: { x: string | null; y: string | null }
): Promise<void> => {
  const result = await sql<{ id: string; owner: string | null }>`
    SELECT __id AS id, ${sql.id(fixture.ownerColumn)} AS owner
    FROM ${sql.table(fixture.childDbTableName)}
    WHERE __id IN (${fixture.x.id}, ${fixture.y.id})
  `.execute(ctx.testContainer.db);
  expect(result.rows).toHaveLength(2);
  const ownerById = new Map(result.rows.map(({ id, owner }) => [id, owner]));
  expect(ownerById.get(fixture.x.id), 'physical FK for X').toBe(expected.x);
  expect(ownerById.get(fixture.y.id), 'physical FK for Y').toBe(expected.y);
};

const expectConsistentState = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  linkedChild: 'x' | 'y',
  marker: string
): Promise<void> => {
  const child = fixture[linkedChild];
  const childrenValue = [{ id: child.id, title: linkedChild.toUpperCase() }];
  const parentValue = { id: fixture.p.id, title: 'P' };
  const parentRows = await sql<{ id: string; children: unknown; marker: unknown }>`
    SELECT __id AS id, ${sql.id(fixture.childrenColumn)} AS children,
      ${sql.id(fixture.markerColumn)} AS marker
    FROM ${sql.table(fixture.parentDbTableName)}
    WHERE __id IN (${fixture.p.id}, ${fixture.q.id})
  `.execute(ctx.testContainer.db);
  expect(parentRows.rows).toHaveLength(2);
  expect(parentRows.rows.find(({ id }) => id === fixture.p.id)?.children).toEqual(childrenValue);
  expect(parentRows.rows.find(({ id }) => id === fixture.q.id)?.marker).toBe(marker);
  const childRows = await sql<{ id: string; owner: string | null; parent: unknown }>`
    SELECT __id AS id, ${sql.id(fixture.ownerColumn)} AS owner,
      ${sql.id(fixture.parentColumn)} AS parent
    FROM ${sql.table(fixture.childDbTableName)}
    WHERE __id IN (${fixture.x.id}, ${fixture.y.id})
  `.execute(ctx.testContainer.db);
  expect(childRows.rows).toHaveLength(2);
  for (const row of childRows.rows) {
    const ownsChild = row.id === child.id;
    expect(row.owner, `physical FK for ${row.id}`).toBe(ownsChild ? fixture.p.id : null);
    expect(row.parent, `stored inverse cache for ${row.id}`).toEqual(
      ownsChild ? parentValue : null
    );
  }
  // Read HTTP-visible values without draining work while T1 still holds its gate.
  const parents = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
  const children = await ctx.listRecordsWithoutDrain(fixture.childTableId);
  expect(parents.find(({ id }) => id === fixture.p.id)?.fields[fixture.childrenFieldId]).toEqual(
    childrenValue
  );
  expect(parents.find(({ id }) => id === fixture.q.id)?.fields[fixture.markerFieldId]).toBe(marker);
  for (const record of children) {
    expect(record.fields[fixture.parentFieldId] ?? null).toEqual(
      record.id === child.id ? parentValue : null
    );
  }
};

// Separate from release/claim tests: Q changes only a scalar, never a link.
describe('oneMany mixed no-op cannot replay stale inverse caches (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('keeps T2 P.Children=[Y] and both inverse caches after T1 P.Children=[X] no-op resumes', async () => {
    const fixture = await createFixture(ctx);
    const prefix = `t8242_noop_inverse_${getRandomString(8).toLowerCase()}`;
    const names: Instrumentation = {
      functionName: `${prefix}_fn`,
      triggerName: `${prefix}_trg`,
      gateKey: `${prefix}:after-main-update`,
    };
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;
    try {
      await expectConsistentState(ctx, fixture, 'x', 'Q initial');
      await installGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.gateKey);
      const t1 = postUpdate(ctx, 'updateRecords', {
        tableId: fixture.parentTableId,
        records: [
          // Full cached title is essential: ID-only is not a genuine JSONB no-op.
          {
            id: fixture.p.id,
            fields: { [fixture.childrenFieldId]: [{ id: fixture.x.id, title: 'X' }] },
          },
          { id: fixture.q.id, fields: { [fixture.markerFieldId]: T1_MARKER } },
        ],
      });
      requests.push(t1);
      void Promise.allSettled(requests);
      const t1Pid = await Promise.race([
        waitForT1AtGate(ctx, fixture, gate.pid),
        t1.then((result) => {
          throw new Error(`T1 finished before its main-SQL gate: ${JSON.stringify(result)}`);
        }),
      ]);
      const t2 = postUpdate(ctx, 'updateRecord', {
        tableId: fixture.parentTableId,
        recordId: fixture.p.id,
        fields: { [fixture.childrenFieldId]: [{ id: fixture.y.id, title: 'Y' }] },
      });
      requests.push(t2);
      void Promise.allSettled(requests);
      const t2Result = await waitForT2Commit(ctx, t2, t1Pid);
      expect(t2Result.status, JSON.stringify(t2Result.body)).toBe(200);
      expect(t2Result.body).toEqual(expect.objectContaining({ ok: true }));
      // The physical FKs are synchronous commit evidence. Do not drain the computed
      // outbox while T1 is gated: a cache job may legitimately wait on T1's locks.
      await expectPhysicalOwners(ctx, fixture, { x: null, y: fixture.p.id });
      expect(gate.automaticallyReleased, 'T2 must commit before any gate release').toBe(false);
      await gate.release();
      const t1Result = await t1;
      expect(t1Result.status, JSON.stringify(t1Result.body)).toBe(200);
      expect(t1Result.body).toEqual(expect.objectContaining({ ok: true }));
      // Once T1 is committed, let deferred inverse-cache work converge before
      // asserting the final physical and cached representations together.
      await ctx.drainOutbox();
      await expectConsistentState(ctx, fixture, 'y', T1_MARKER);
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropGate(ctx, fixture, names);
    }
  }, 60_000);
});
