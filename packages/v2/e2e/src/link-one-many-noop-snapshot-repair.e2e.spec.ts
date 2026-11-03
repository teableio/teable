/* eslint-disable @typescript-eslint/naming-convention */
import { setTimeout as delay } from 'node:timers/promises';
import { updateRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const WAIT_TIMEOUT_MS = 15_000;

type RecordRef = { id: string };
type ListedRecord = { id: string; fields: Record<string, unknown> };
type ApiResult = { status: number; body: unknown };
type HeldGate = {
  pid: number;
  automaticallyReleased: boolean;
  release(): Promise<void>;
};
type Instrumentation = {
  functionName: string;
  sequenceName: string;
  triggerName: string;
  gateKey: string;
};
type Fixture = {
  parentTableId: string;
  childTableId: string;
  childrenFieldId: string;
  parentFieldId: string;
  parentDbTableName: string;
  childDbTableName: string;
  childrenColumn: string;
  parentColumn: string;
  ownerColumn: string;
  childRelationOid: number;
  parentP: RecordRef;
  parentQ: RecordRef;
  childX: RecordRef;
  childY: RecordRef;
};

const advisoryKey = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

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

const findRecord = (records: ListedRecord[], record: RecordRef): ListedRecord => {
  const found = records.find(({ id }) => id === record.id);
  if (!found) throw new Error(`Missing record ${record.id}`);
  return found;
};

const tableDbName = async (ctx: SharedTestContext, tableId: string): Promise<string> => {
  const row = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', tableId)
    .executeTakeFirstOrThrow();
  return row.db_table_name;
};

const fieldDbName = async (
  ctx: SharedTestContext,
  tableId: string,
  fieldId: string
): Promise<string> => {
  const row = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('table_id', '=', tableId)
    .where('id', '=', fieldId)
    .where('deleted_time', 'is', null)
    .executeTakeFirstOrThrow();
  if (!row.db_field_name) throw new Error(`Missing database column for ${fieldId}`);
  return row.db_field_name;
};

const createFixture = async (ctx: SharedTestContext): Promise<Fixture> => {
  const childTitleFieldId = `fld${getRandomString(16)}`;
  const childTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `No-op snapshot children ${getRandomString(8)}`,
    fields: [{ id: childTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const childDbTableName = await tableDbName(ctx, childTable.id);

  const parentTitleFieldId = `fld${getRandomString(16)}`;
  const parentTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `No-op snapshot parents ${getRandomString(8)}`,
    fields: [{ id: parentTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const parentDbTableName = await tableDbName(ctx, parentTable.id);

  const childrenFieldId = `fld${getRandomString(16)}`;
  const parentFieldId = `fld${getRandomString(16)}`;
  const ownerColumn = `__fk_${parentFieldId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: parentTable.id,
    field: {
      id: childrenFieldId,
      name: 'Children',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: childTable.id,
        lookupFieldId: childTitleFieldId,
        isOneWay: false,
        symmetricFieldId: parentFieldId,
        fkHostTableName: childDbTableName,
        selfKeyName: ownerColumn,
        foreignKeyName: '__id',
      },
    },
  });

  const [parentP, parentQ] = await ctx.createRecords(parentTable.id, [
    { fields: { [parentTitleFieldId]: 'P' } },
    { fields: { [parentTitleFieldId]: 'Q' } },
  ]);
  const [childX, childY] = await ctx.createRecords(childTable.id, [
    { fields: { [childTitleFieldId]: 'X' } },
    { fields: { [childTitleFieldId]: 'Y' } },
  ]);
  if (!parentP || !parentQ || !childX || !childY) {
    throw new Error('Missing no-op snapshot fixture records');
  }

  await ctx.updateRecord(parentTable.id, parentP.id, {
    [childrenFieldId]: [{ id: childX.id }],
  });
  await ctx.drainOutbox();

  const childrenColumn = await fieldDbName(ctx, parentTable.id, childrenFieldId);
  const parentColumn = await fieldDbName(ctx, childTable.id, parentFieldId);
  // Reproduce the historical mismatch: the source cache says P has no children,
  // while X still has both the physical owner FK and its computed inverse cache.
  await sql`
    UPDATE ${sql.table(parentDbTableName)}
    SET ${sql.ref(childrenColumn)} = '[]'::jsonb
    WHERE ${sql.ref('__id')} = ${parentP.id}
  `.execute(ctx.testContainer.db);

  const relation = await sql<{ relation_oid: number }>`
    SELECT tableoid::int AS relation_oid
    FROM ${sql.table(childDbTableName)}
    WHERE ${sql.ref('__id')} = ${childX.id}
  `.execute(ctx.testContainer.db);
  const childRelationOid = relation.rows[0]?.relation_oid;
  if (childRelationOid === undefined) throw new Error('Missing child relation OID');

  return {
    parentTableId: parentTable.id,
    childTableId: childTable.id,
    childrenFieldId,
    parentFieldId,
    parentDbTableName,
    childDbTableName,
    childrenColumn,
    parentColumn,
    ownerColumn,
    childRelationOid,
    parentP,
    parentQ,
    childX,
    childY,
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

const expectUpdateOk = (result: ApiResult): { updatedCount: number } => {
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const parsed = updateRecordsOkResponseSchema.safeParse(result.body);
  expect(parsed.success, JSON.stringify(result.body)).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`updateRecords failed: ${JSON.stringify(result.body)}`);
  }
  return parsed.data.data;
};

const instrumentationNames = (): Instrumentation => {
  const prefix = `t8242_noop_snapshot_${getRandomString(8).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    sequenceName: `${prefix}_attempts`,
    triggerName: `${prefix}_trg`,
    gateKey: `${prefix}:before-first-target-update`,
  };
};

const installFirstTargetUpdateGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await sql`CREATE SEQUENCE ${sql.id('public', names.sequenceName)}`.execute(ctx.testContainer.db);
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      attempt bigint;
    BEGIN
      attempt := nextval(TG_ARGV[0]::regclass);
      IF attempt = 1 THEN
        PERFORM pg_advisory_xact_lock(
          ('x' || substr(md5(TG_ARGV[1]), 1, 16))::bit(64)::bigint
        );
      END IF;
      RETURN NULL;
    END;
    $$
  `.execute(ctx.testContainer.db);
  // A statement trigger pauses the repair before PostgreSQL selects or locks the
  // snapshot token's tuple. Later target statements bypass it, so the competing
  // transaction can commit between token capture and the repair CAS.
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    BEFORE UPDATE ON ${sql.table(fixture.childDbTableName)}
    FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.sequenceName}`)},
      ${sql.lit(names.gateKey)}
    )
  `.execute(ctx.testContainer.db);
};

const dropFirstTargetUpdateGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await sql`
    DROP TRIGGER IF EXISTS ${sql.id(names.triggerName)}
    ON ${sql.table(fixture.childDbTableName)}
  `.execute(ctx.testContainer.db);
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
  await sql`DROP SEQUENCE IF EXISTS ${sql.id('public', names.sequenceName)}`.execute(
    ctx.testContainer.db
  );
};

const holdGate = async (ctx: SharedTestContext, key: string): Promise<HeldGate> => {
  const acquired = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
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

const waitForRepairAtGate = async (
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
            AND relation_lock.relation = ${fixture.childRelationOid}::oid
        )
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return result.rows[0]!.pid;
    expect(result.rows, 'only the stale-FK repair should wait at the target gate').toHaveLength(0);
    await delay(20);
  }
  throw new Error('The stale-FK repair did not reach its pre-CAS gate');
};

const waitForRequest = async (
  ctx: SharedTestContext,
  request: Promise<ApiResult>,
  repairPid: number,
  gatePid: number
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
            AND (
              pid = ${repairPid}
              OR ${repairPid} = ANY(pg_blocking_pids(pid))
              OR ${gatePid} = ANY(pg_blocking_pids(pid))
            )
          ORDER BY pid
        `.execute(ctx.testContainer.db);
        throw new Error(
          `Concurrent request did not commit before repair release: ${JSON.stringify(waiters.rows)}`
        );
      }),
    ]);
  } finally {
    timeout.abort();
  }
};

const readOwners = async (
  ctx: SharedTestContext,
  fixture: Fixture
): Promise<Map<string, string | null>> => {
  const result = await sql<{ child_id: string; owner_id: string | null }>`
    SELECT ${sql.ref('__id')} AS child_id, ${sql.ref(fixture.ownerColumn)} AS owner_id
    FROM ${sql.table(fixture.childDbTableName)}
    WHERE ${sql.ref('__id')} IN (${fixture.childX.id}, ${fixture.childY.id})
  `.execute(ctx.testContainer.db);
  expect(result.rows).toHaveLength(2);
  return new Map(result.rows.map(({ child_id, owner_id }) => [child_id, owner_id]));
};

const expectConsistentLinks = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  expected: { pChildren: string[]; xOwner?: string; yOwner?: string }
): Promise<void> => {
  const parents = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
  const children = await ctx.listRecordsWithoutDrain(fixture.childTableId);
  expect(linkIds(findRecord(parents, fixture.parentP).fields[fixture.childrenFieldId])).toEqual(
    expected.pChildren
  );
  expect(singleLinkId(findRecord(children, fixture.childX).fields[fixture.parentFieldId])).toBe(
    expected.xOwner
  );
  expect(singleLinkId(findRecord(children, fixture.childY).fields[fixture.parentFieldId])).toBe(
    expected.yOwner
  );

  const owners = await readOwners(ctx, fixture);
  expect(owners.get(fixture.childX.id)).toBe(expected.xOwner ?? null);
  expect(owners.get(fixture.childY.id)).toBe(expected.yOwner ?? null);
};

describe('oneMany no-op stale-FK snapshot repair (HTTP/PostgreSQL e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('releases only the snapshotted stale FK and preserves a concurrently joined target', async () => {
    const fixture = await createFixture(ctx);
    const names = instrumentationNames();
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await installFirstTargetUpdateGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.gateKey);

      const repair = postUpdateRecords(ctx, fixture.parentTableId, [
        { id: fixture.parentP.id, fields: { [fixture.childrenFieldId]: [] } },
      ]);
      requests.push(repair);
      void Promise.allSettled(requests);
      const repairPid = await Promise.race([
        waitForRepairAtGate(ctx, fixture, gate.pid),
        repair.then((result) => {
          throw new Error(`Repair finished before its pre-CAS gate: ${JSON.stringify(result)}`);
        }),
      ]);

      // Enroll Y from the inverse side; replacing P.Children would also release
      // stale X and would test a different CAS-conflict scenario.
      const join = postUpdateRecords(ctx, fixture.childTableId, [
        {
          id: fixture.childY.id,
          fields: { [fixture.parentFieldId]: { id: fixture.parentP.id } },
        },
      ]);
      requests.push(join);
      void Promise.allSettled(requests);
      const joinResult = await waitForRequest(ctx, join, repairPid, gate.pid);
      expect(expectUpdateOk(joinResult).updatedCount).toBe(1);
      const ownersBeforeRelease = await readOwners(ctx, fixture);
      expect(ownersBeforeRelease.get(fixture.childX.id)).toBe(fixture.parentP.id);
      expect(ownersBeforeRelease.get(fixture.childY.id)).toBe(fixture.parentP.id);
      expect(gate.automaticallyReleased, 'join must commit before any gate release').toBe(false);

      await gate.release();
      const repairResult = await repair;
      expect(expectUpdateOk(repairResult).updatedCount).toBe(0);
      await ctx.drainOutbox();

      await expectConsistentLinks(ctx, fixture, {
        pChildren: [fixture.childY.id],
        yOwner: fixture.parentP.id,
      });
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropFirstTargetUpdateGate(ctx, fixture, names);
    }
  }, 60_000);

  it('rejects a same-owner ABA instead of clearing a replacement tuple', async () => {
    const fixture = await createFixture(ctx);
    const names = instrumentationNames();
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await installFirstTargetUpdateGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.gateKey);

      const repair = postUpdateRecords(ctx, fixture.parentTableId, [
        { id: fixture.parentP.id, fields: { [fixture.childrenFieldId]: [] } },
      ]);
      requests.push(repair);
      void Promise.allSettled(requests);
      await Promise.race([
        waitForRepairAtGate(ctx, fixture, gate.pid),
        repair.then((result) => {
          throw new Error(`Repair finished before its pre-CAS gate: ${JSON.stringify(result)}`);
        }),
      ]);

      // Commit P -> Q -> P after snapshot capture. The visible owner is unchanged,
      // but xmin/ctid identify a different tuple version, so the repair CAS must miss.
      await ctx.testContainer.db.transaction().execute(async (trx) => {
        await sql`
          UPDATE ${sql.table(fixture.childDbTableName)}
          SET ${sql.ref(fixture.ownerColumn)} = ${fixture.parentQ.id}
          WHERE ${sql.ref('__id')} = ${fixture.childX.id}
        `.execute(trx);
        await sql`
          UPDATE ${sql.table(fixture.childDbTableName)}
          SET ${sql.ref(fixture.ownerColumn)} = ${fixture.parentP.id}
          WHERE ${sql.ref('__id')} = ${fixture.childX.id}
        `.execute(trx);
      });

      expect(gate.automaticallyReleased, 'ABA must commit before any gate release').toBe(false);
      await gate.release();
      const repairResult = await repair;
      expect(repairResult.status).toBeGreaterThanOrEqual(400);
      expect(repairResult.status).toBeLessThan(500);
      expect(JSON.stringify(repairResult.body)).toContain(
        'conflict.link.noop_release_generation_changed'
      );

      const owners = await readOwners(ctx, fixture);
      expect(owners.get(fixture.childX.id)).toBe(fixture.parentP.id);
      const parents = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
      const children = await ctx.listRecordsWithoutDrain(fixture.childTableId);
      expect(linkIds(findRecord(parents, fixture.parentP).fields[fixture.childrenFieldId])).toEqual(
        []
      );
      expect(singleLinkId(findRecord(children, fixture.childX).fields[fixture.parentFieldId])).toBe(
        fixture.parentP.id
      );
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropFirstTargetUpdateGate(ctx, fixture, names);
    }
  }, 60_000);

  it('propagates an all-no-op physical repair both ways without incrementing source count', async () => {
    const fixture = await createFixture(ctx);
    const result = await postUpdateRecords(ctx, fixture.parentTableId, [
      { id: fixture.parentP.id, fields: { [fixture.childrenFieldId]: [] } },
    ]);
    expect(expectUpdateOk(result).updatedCount).toBe(0);
    await ctx.drainOutbox();

    await expectConsistentLinks(ctx, fixture, { pChildren: [] });
    const rawCaches = await sql<{ parent_children: unknown; child_parent: unknown }>`
      SELECT parent_row.${sql.ref(fixture.childrenColumn)} AS parent_children,
        child_row.${sql.ref(fixture.parentColumn)} AS child_parent
      FROM ${sql.table(fixture.parentDbTableName)} AS parent_row
      CROSS JOIN ${sql.table(fixture.childDbTableName)} AS child_row
      WHERE parent_row.${sql.ref('__id')} = ${fixture.parentP.id}
        AND child_row.${sql.ref('__id')} = ${fixture.childX.id}
    `.execute(ctx.testContainer.db);
    // Computed links use jsonb_agg: an empty relation is stored as SQL NULL,
    // unlike the deliberately injected [] cache that made the source a no-op.
    expect(rawCaches.rows).toEqual([{ parent_children: null, child_parent: null }]);
  }, 120_000);
});
