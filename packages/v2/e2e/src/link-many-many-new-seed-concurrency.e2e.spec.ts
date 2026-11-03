/* eslint-disable @typescript-eslint/naming-convention */
import { setTimeout as delay } from 'node:timers/promises';
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const WAIT_TIMEOUT_MS = 15_000;

type RecordRef = { id: string };
type LinkValue = { id: string; title: string };
type ApiResult = { status: number; body: unknown };
type HeldGate = { pid: number; release(): Promise<void> };

type LinkOptions = {
  fkHostTableName?: string;
  selfKeyName?: string;
  foreignKeyName?: string;
  symmetricFieldId?: string;
};

type Fixture = {
  sourceTableId: string;
  targetTableId: string;
  sourceDbTableName: string;
  targetDbTableName: string;
  markerFieldId: string;
  markerColumn: string;
  primaryFieldId: string;
  primaryColumn: string;
  linkFieldId: string;
  linkColumn: string;
  reverseFieldId: string;
  reverseColumn: string;
  junctionTableName: string;
  sourceKeyColumn: string;
  targetKeyColumn: string;
  source: RecordRef;
  sourceB: RecordRef;
  targetB: RecordRef;
  targetC: RecordRef;
};

type GateNames = {
  functionName: string;
  triggerName: string;
  key: string;
};

type ExpectedState = {
  marker: number;
  sourceTarget: LinkValue;
  reverseB: LinkValue[];
  reverseC: LinkValue[];
};

const advisoryKey = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

const linkIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('id' in item)) return [];
    return typeof item.id === 'string' ? [item.id] : [];
  });
};

const findRecord = <T extends RecordRef>(records: ReadonlyArray<T>, record: RecordRef): T => {
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

const fieldDbName = async (ctx: SharedTestContext, fieldId: string): Promise<string> => {
  const row = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('id', '=', fieldId)
    .executeTakeFirstOrThrow();
  if (!row.db_field_name) throw new Error(`Missing database column for ${fieldId}`);
  return row.db_field_name;
};

const postUpdate = async (
  ctx: SharedTestContext,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<ApiResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, recordId, fields }),
    signal: AbortSignal.timeout(45_000),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
};

const createFixture = async (ctx: SharedTestContext): Promise<Fixture> => {
  const targetTitleFieldId = `fld${getRandomString(16)}`;
  const targets = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Many-many new seed targets ${getRandomString(8)}`,
    fields: [{ id: targetTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const [targetB, targetC] = await ctx.createRecords(targets.id, [
    { fields: { [targetTitleFieldId]: 'B' } },
    { fields: { [targetTitleFieldId]: 'C' } },
  ]);
  if (!targetB || !targetC) throw new Error('Missing B/C target records');

  const markerFieldId = `fld${getRandomString(16)}`;
  const primaryFieldId = `fld${getRandomString(16)}`;
  const linkFieldId = `fld${getRandomString(16)}`;
  const sources = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Many-many new seed sources ${getRandomString(8)}`,
    fields: [
      { id: markerFieldId, name: 'Marker', type: 'number' },
      {
        id: primaryFieldId,
        name: 'Name',
        type: 'formula',
        isPrimary: true,
        // A primitive dependency puts the formula in T1's plan. Its unchanged
        // scalar value gates title propagation; a literal or link-dependent
        // formula would not exercise that same value-frontier path.
        options: { expression: `IF({${markerFieldId}} >= 0, "S", "S")` },
      },
      {
        id: linkFieldId,
        name: 'Targets',
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: targets.id,
          lookupFieldId: targetTitleFieldId,
          isOneWay: false,
        },
      },
    ],
    views: [{ type: 'grid' }],
  });
  const sourceTable = await ctx.getTableById(sources.id);
  const options = sourceTable.fields.find((field) => field.id === linkFieldId)?.options as
    | LinkOptions
    | undefined;
  if (
    !options?.fkHostTableName ||
    !options.selfKeyName ||
    !options.foreignKeyName ||
    !options.symmetricFieldId
  ) {
    throw new Error('Many-many link storage metadata is incomplete');
  }

  const sourceDbTableName = await tableDbName(ctx, sources.id);
  const primaryColumn = await fieldDbName(ctx, primaryFieldId);
  const primaryMeta = await ctx.testContainer.db
    .selectFrom('field')
    .select('meta')
    .where('id', '=', primaryFieldId)
    .executeTakeFirstOrThrow();
  const meta = primaryMeta.meta ? (JSON.parse(primaryMeta.meta) as Record<string, unknown>) : {};
  expect(meta.persistedAsGeneratedColumn ?? false).toBe(false);
  const quotedRelation = sql.table(sourceDbTableName).compile(ctx.testContainer.db).sql;
  const storage = await sql<{ generated: string }>`
    SELECT attgenerated::text AS generated
    FROM pg_attribute
    WHERE attrelid = ${quotedRelation}::regclass
      AND attname = ${primaryColumn}
      AND NOT attisdropped
  `.execute(ctx.testContainer.db);
  expect(storage.rows, 'the primary must be a stored, non-generated formula').toEqual([
    { generated: '' },
  ]);

  const source = await ctx.createRecord(sources.id, {
    [markerFieldId]: 0,
    [linkFieldId]: [{ id: targetB.id }],
  });
  const sourceB = await ctx.createRecord(sources.id, {
    [markerFieldId]: 0,
  });
  return {
    sourceTableId: sources.id,
    targetTableId: targets.id,
    sourceDbTableName,
    targetDbTableName: await tableDbName(ctx, targets.id),
    markerFieldId,
    markerColumn: await fieldDbName(ctx, markerFieldId),
    primaryFieldId,
    primaryColumn,
    linkFieldId,
    linkColumn: await fieldDbName(ctx, linkFieldId),
    reverseFieldId: options.symmetricFieldId,
    reverseColumn: await fieldDbName(ctx, options.symmetricFieldId),
    junctionTableName: options.fkHostTableName,
    sourceKeyColumn: options.selfKeyName,
    targetKeyColumn: options.foreignKeyName,
    source,
    sourceB,
    targetB,
    targetC,
  };
};

const drainComputed = async (ctx: SharedTestContext, fixture: Fixture): Promise<void> => {
  await ctx.drainOutbox(100);
  const tableIds = [fixture.sourceTableId, fixture.targetTableId];
  const scope = sql`
    base_id = ${ctx.baseId}
    AND (
      seed_table_id IN (${sql.join(tableIds)})
      OR affected_table_ids && ${tableIds}::text[]
    )
  `;
  const remaining = await sql<{ pending: number; dead: number }>`
    SELECT
      (SELECT count(*)::int FROM computed_update_outbox WHERE ${scope}) AS pending,
      (SELECT count(*)::int FROM computed_update_dead_letter WHERE ${scope}) AS dead
  `.execute(ctx.testContainer.db);
  expect(remaining.rows, 'all fixture computed work must finish before the next phase').toEqual([
    { pending: 0, dead: 0 },
  ]);
};

const expectState = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  expected: ExpectedState
): Promise<void> => {
  const source = findRecord(
    await ctx.listRecordsWithoutDrain(fixture.sourceTableId),
    fixture.source
  );
  expect(source.fields[fixture.markerFieldId]).toBe(expected.marker);
  expect(source.fields[fixture.primaryFieldId]).toBe('S');
  expect(source.fields[fixture.linkFieldId]).toEqual([expected.sourceTarget]);
  const targets = await ctx.listRecordsWithoutDrain(fixture.targetTableId);
  expect(findRecord(targets, fixture.targetB).fields[fixture.reverseFieldId] ?? []).toEqual(
    expected.reverseB
  );
  expect(findRecord(targets, fixture.targetC).fields[fixture.reverseFieldId] ?? []).toEqual(
    expected.reverseC
  );

  // Read physical caches too: a query-time computed projection must not hide a
  // missing symmetric-link seed while the authoritative junction is correct.
  const storedSource = await sql<{ marker: number; title: string; links: unknown }>`
    SELECT
      ${sql.id(fixture.markerColumn)} AS marker,
      ${sql.id(fixture.primaryColumn)} AS title,
      ${sql.id(fixture.linkColumn)} AS links
    FROM ${sql.table(fixture.sourceDbTableName)}
    WHERE __id = ${fixture.source.id}
  `.execute(ctx.testContainer.db);
  expect(storedSource.rows).toEqual([
    { marker: expected.marker, title: 'S', links: [expected.sourceTarget] },
  ]);
  const storedTargets = await sql<{ id: string; links: unknown }>`
    SELECT __id AS id, ${sql.id(fixture.reverseColumn)} AS links
    FROM ${sql.table(fixture.targetDbTableName)}
    WHERE __id IN (${fixture.targetB.id}, ${fixture.targetC.id})
  `.execute(ctx.testContainer.db);
  expect(findRecord(storedTargets.rows, fixture.targetB).links ?? []).toEqual(expected.reverseB);
  expect(findRecord(storedTargets.rows, fixture.targetC).links ?? []).toEqual(expected.reverseC);
  const junction = await sql<{ source_id: string; target_id: string }>`
    SELECT
      ${sql.id(fixture.sourceKeyColumn)} AS source_id,
      ${sql.id(fixture.targetKeyColumn)} AS target_id
    FROM ${sql.table(fixture.junctionTableName)}
    WHERE ${sql.id(fixture.sourceKeyColumn)} = ${fixture.source.id}
  `.execute(ctx.testContainer.db);
  expect(junction.rows).toEqual([
    { source_id: fixture.source.id, target_id: expected.sourceTarget.id },
  ]);
};

const installGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: GateNames
): Promise<void> => {
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(
        ('x' || substr(md5(TG_ARGV[0]), 1, 16))::bit(64)::bigint
      );
      RETURN NULL;
    END;
    $$
  `.execute(ctx.testContainer.db);
  // The update builder has already read B, but a statement trigger runs before
  // any source tuple is locked. Only T1 writes Marker, so T2 and its computed
  // work can commit C while T1 still holds its stale "retain B" mutation plan.
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    BEFORE UPDATE OF ${sql.id(fixture.markerColumn)}
    ON ${sql.table(fixture.sourceDbTableName)}
    FOR EACH STATEMENT
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(${sql.lit(names.key)})
  `.execute(ctx.testContainer.db);
};

const installJunctionGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  sourceId: string,
  targetId: string,
  names: GateNames
): Promise<void> => {
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(
        ('x' || substr(md5(TG_ARGV[0]), 1, 16))::bit(64)::bigint
      );
      RETURN NEW;
    END;
    $$
  `.execute(ctx.testContainer.db);
  // Default hybrid computation may defer X's symmetric-cache write to the
  // outbox. The authoritative A-X junction INSERT is synchronous, so this gate
  // deterministically holds T1 after the restore while it still owns X's link lock.
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    AFTER INSERT ON ${sql.table(fixture.junctionTableName)}
    FOR EACH ROW WHEN (
      NEW.${sql.id(fixture.sourceKeyColumn)} = ${sql.lit(sourceId)}
      AND NEW.${sql.id(fixture.targetKeyColumn)} = ${sql.lit(targetId)}
    )
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(${sql.lit(names.key)})
  `.execute(ctx.testContainer.db);
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
  description = 'T1 after its stale pre-read'
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
    expect(result.rows, `only one backend may wait: ${description}`).toHaveLength(0);
    await delay(20);
  }
  throw new Error(`PostgreSQL did not observe ${description} at its advisory gate`);
};

const waitForAdvisoryLock = async (
  ctx: SharedTestContext,
  blockerPid: number,
  lockKey: string,
  description: string
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
          FROM pg_locks AS waiting_lock
          WHERE waiting_lock.pid = activity.pid
            AND waiting_lock.locktype = 'advisory'
            AND waiting_lock.mode = 'ExclusiveLock'
            AND waiting_lock.granted = false
            AND waiting_lock.objsubid = 1
            AND (
              (waiting_lock.classid::bigint << 32) | waiting_lock.objid::bigint
            )::bit(64) = (${advisoryKey(lockKey)})::bit(64)
        )
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return result.rows[0]!.pid;
    expect(result.rows, `only one backend may wait: ${description}`).toHaveLength(0);
    await delay(20);
  }
  throw new Error(`PostgreSQL did not observe ${description}`);
};

const dropGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: GateNames
): Promise<void> => {
  await sql`
    DROP TRIGGER IF EXISTS ${sql.id(names.triggerName)}
    ON ${sql.table(fixture.sourceDbTableName)}
  `.execute(ctx.testContainer.db);
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
};

const dropJunctionGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: GateNames
): Promise<void> => {
  await sql`
    DROP TRIGGER IF EXISTS ${sql.id(names.triggerName)}
    ON ${sql.table(fixture.junctionTableName)}
  `.execute(ctx.testContainer.db);
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
};

describe('manyMany captured NEW seeds (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('restores the retained target inverse cache after a stale pre-read with unchanged primary value', async () => {
    const fixture = await createFixture(ctx);
    const prefix = `t8242_m2m_new_${getRandomString(8).toLowerCase()}`;
    const names: GateNames = {
      functionName: `${prefix}_fn`,
      triggerName: `${prefix}_trg`,
      key: `${prefix}:before-source-update`,
    };
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;
    const atB: ExpectedState = {
      marker: 0,
      sourceTarget: { id: fixture.targetB.id, title: 'B' },
      reverseB: [{ id: fixture.source.id, title: 'S' }],
      reverseC: [],
    };

    try {
      await drainComputed(ctx, fixture);
      await expectState(ctx, fixture, atB);
      await installGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.key);

      // T1 sees B and requests B again, so the pre-read link diff has no NEW B
      // seed. Changing Marker forces a real write and schedules the constant
      // primary formula without letting its value change repair the inverse.
      const t1 = postUpdate(ctx, fixture.sourceTableId, fixture.source.id, {
        [fixture.markerFieldId]: 1,
        [fixture.linkFieldId]: [{ id: fixture.targetB.id }],
      });
      requests.push(t1);
      void Promise.allSettled(requests);
      await waitForBlockedBackend(ctx, gate.pid);

      const t2 = postUpdate(ctx, fixture.sourceTableId, fixture.source.id, {
        [fixture.linkFieldId]: [{ id: fixture.targetC.id }],
      });
      requests.push(t2);
      void Promise.allSettled(requests);
      const t2Result = await t2;
      expect(t2Result.status, JSON.stringify(t2Result.body)).toBe(200);
      expect(t2Result.body).toEqual(expect.objectContaining({ ok: true }));
      await drainComputed(ctx, fixture);
      // Independent HTTP/SQL reads plus an empty queue prove that T2 committed
      // and cleared B's inverse cache before T1 is allowed to restore B.
      await expectState(ctx, fixture, {
        marker: 0,
        sourceTarget: { id: fixture.targetC.id, title: 'C' },
        reverseB: [],
        reverseC: [{ id: fixture.source.id, title: 'S' }],
      });

      ctx.clearLogs();
      await gate.release();
      const t1Result = await t1;
      expect(t1Result.status, JSON.stringify(t1Result.body)).toBe(200);
      expect(t1Result.body).toEqual(expect.objectContaining({ ok: true }));
      const seedPlan = ctx.testContainer
        .getComputedPlans()
        .find(
          (plan) =>
            plan.seedTableId === fixture.sourceTableId &&
            plan.seedRecordIds.includes(fixture.source.id) &&
            plan.steps.some((step) => step.fieldIds.includes(fixture.primaryFieldId))
        );
      expect(seedPlan, 'T1 must recompute the stored constant primary').toBeDefined();
      expect(seedPlan?.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: `${fixture.sourceTableId}.${fixture.primaryFieldId}`,
            to: `${fixture.targetTableId}.${fixture.reverseFieldId}`,
            propagationMode: 'linkTraversal',
            hasFilterCondition: false,
          }),
        ])
      );

      await drainComputed(ctx, fixture);
      // OLD=C alone can remove C but cannot restore B after primary-value
      // gating. The actual NEW=B snapshot must seed B despite the stale diff.
      await expectState(ctx, fixture, { ...atB, marker: 1 });
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropGate(ctx, fixture, names);
    }
  }, 60_000);

  it('serializes a concurrent second source on X while retained X is restored', async () => {
    const fixture = await createFixture(ctx);
    const sourceA = fixture.source;
    const sourceB = fixture.sourceB;
    const targetX = fixture.targetB;
    const targetY = fixture.targetC;
    const sourcePrefix = `t8242_m2m_three_source_${getRandomString(8).toLowerCase()}`;
    const junctionPrefix = `t8242_m2m_three_junction_${getRandomString(8).toLowerCase()}`;
    const sourceNames: GateNames = {
      functionName: `${sourcePrefix}_fn`,
      triggerName: `${sourcePrefix}_trg`,
      key: `${sourcePrefix}:before-source-update`,
    };
    const junctionNames: GateNames = {
      functionName: `${junctionPrefix}_fn`,
      triggerName: `${junctionPrefix}_trg`,
      key: `${junctionPrefix}:after-a-x-insert`,
    };
    const requests: Promise<ApiResult>[] = [];
    let sourceGate: HeldGate | undefined;
    let junctionGate: HeldGate | undefined;

    try {
      await drainComputed(ctx, fixture);
      await expectState(ctx, fixture, {
        marker: 0,
        sourceTarget: { id: targetX.id, title: 'B' },
        reverseB: [{ id: sourceA.id, title: 'S' }],
        reverseC: [],
      });
      const initialSources = await ctx.listRecordsWithoutDrain(fixture.sourceTableId);
      expect(linkIds(findRecord(initialSources, sourceB).fields[fixture.linkFieldId])).toEqual([]);

      await installGate(ctx, fixture, sourceNames);
      sourceGate = await holdGate(ctx, sourceNames.key);

      // T1 pre-reads A-X and requests X again. Its marker write makes the
      // request real while preserving the stale "no NEW X" link diff.
      const t1 = postUpdate(ctx, fixture.sourceTableId, sourceA.id, {
        [fixture.markerFieldId]: 1,
        [fixture.linkFieldId]: [{ id: targetX.id }],
      });
      requests.push(t1);
      void Promise.allSettled(requests);
      const t1Pid = await waitForBlockedBackend(ctx, sourceGate.pid);

      // T2 commits A-Y while T1 still retains its old A-X pre-read.
      const t2 = postUpdate(ctx, fixture.sourceTableId, sourceA.id, {
        [fixture.linkFieldId]: [{ id: targetY.id }],
      });
      requests.push(t2);
      void Promise.allSettled(requests);
      const t2Result = await t2;
      expect(t2Result.status, JSON.stringify(t2Result.body)).toBe(200);
      expect(t2Result.body).toEqual(expect.objectContaining({ ok: true }));
      await drainComputed(ctx, fixture);
      await expectState(ctx, fixture, {
        marker: 0,
        sourceTarget: { id: targetY.id, title: 'C' },
        reverseB: [],
        reverseC: [{ id: sourceA.id, title: 'S' }],
      });

      // Install after T2 commits A-Y. The junction trigger identifies only
      // T1's synchronous A-X restore and is independent of hybrid sync policy.
      await installJunctionGate(ctx, fixture, sourceA.id, targetX.id, junctionNames);
      junctionGate = await holdGate(ctx, junctionNames.key);
      await sourceGate.release();
      const t1AtJunctionPid = await waitForBlockedBackend(
        ctx,
        junctionGate.pid,
        'T1 after restoring the A-X junction but before commit'
      );
      expect(t1AtJunctionPid).toBe(t1Pid);

      // T3 starts B-X while T1 is still uncommitted. Production link-target
      // coordination serializes it before relation or computed writeback on the
      // exact X key, so it cannot prepare a stale X cache snapshot.
      const t3 = postUpdate(ctx, fixture.sourceTableId, sourceB.id, {
        [fixture.linkFieldId]: [{ id: targetX.id }],
      });
      requests.push(t3);
      void Promise.allSettled(requests);
      const t3Pid = await waitForAdvisoryLock(
        ctx,
        t1Pid,
        `v2:link:${ctx.baseId}:${fixture.targetTableId}:${targetX.id}`,
        'T3 on X link-target advisory lock'
      );
      expect(t3Pid).not.toBe(t1Pid);

      // A separate checkout still sees only T2's A-Y edge and its cleared X
      // cache. T1's A-X and T3's B-X transactions are both uncommitted.
      const committedDuringBarrier = await sql<{ source_id: string; target_id: string }>`
        SELECT
          ${sql.id(fixture.sourceKeyColumn)} AS source_id,
          ${sql.id(fixture.targetKeyColumn)} AS target_id
        FROM ${sql.table(fixture.junctionTableName)}
        WHERE ${sql.id(fixture.sourceKeyColumn)} IN (${sourceA.id}, ${sourceB.id})
        ORDER BY ${sql.id(fixture.sourceKeyColumn)}, ${sql.id(fixture.targetKeyColumn)}
      `.execute(ctx.testContainer.db);
      expect(committedDuringBarrier.rows).toEqual([
        { source_id: sourceA.id, target_id: targetY.id },
      ]);

      const storedXDuringBarrier = await sql<{ links: unknown }>`
        SELECT ${sql.id(fixture.reverseColumn)} AS links
        FROM ${sql.table(fixture.targetDbTableName)}
        WHERE __id = ${targetX.id}
      `.execute(ctx.testContainer.db);
      expect(linkIds(storedXDuringBarrier.rows[0]?.links)).toEqual([]);

      await junctionGate.release();
      const [t1Result, t3Result] = await Promise.all([t1, t3]);
      expect(t1Result.status, JSON.stringify(t1Result.body)).toBe(200);
      expect(t1Result.body).toEqual(expect.objectContaining({ ok: true }));
      expect(t3Result.status, JSON.stringify(t3Result.body)).toBe(200);
      expect(t3Result.body).toEqual(expect.objectContaining({ ok: true }));

      // drainComputed also proves no fixture task remains pending or dead.
      await drainComputed(ctx, fixture);
      const sources = await ctx.listRecordsWithoutDrain(fixture.sourceTableId);
      expect(linkIds(findRecord(sources, sourceA).fields[fixture.linkFieldId])).toEqual([
        targetX.id,
      ]);
      expect(linkIds(findRecord(sources, sourceB).fields[fixture.linkFieldId])).toEqual([
        targetX.id,
      ]);
      expect(findRecord(sources, sourceA).fields[fixture.markerFieldId]).toBe(1);

      const expectedSourceIds = [sourceA.id, sourceB.id].sort();
      const targets = await ctx.listRecordsWithoutDrain(fixture.targetTableId);
      expect(linkIds(findRecord(targets, targetX).fields[fixture.reverseFieldId]).sort()).toEqual(
        expectedSourceIds
      );
      expect(linkIds(findRecord(targets, targetY).fields[fixture.reverseFieldId])).toEqual([]);

      const storedX = await sql<{ links: unknown }>`
        SELECT ${sql.id(fixture.reverseColumn)} AS links
        FROM ${sql.table(fixture.targetDbTableName)}
        WHERE __id = ${targetX.id}
      `.execute(ctx.testContainer.db);
      expect(linkIds(storedX.rows[0]?.links).sort()).toEqual(expectedSourceIds);

      const junction = await sql<{ source_id: string; target_id: string }>`
        SELECT
          ${sql.id(fixture.sourceKeyColumn)} AS source_id,
          ${sql.id(fixture.targetKeyColumn)} AS target_id
        FROM ${sql.table(fixture.junctionTableName)}
        WHERE ${sql.id(fixture.sourceKeyColumn)} IN (${sourceA.id}, ${sourceB.id})
      `.execute(ctx.testContainer.db);
      // Junction membership is the contract; SQL returns rows in database
      // collation order, which need not match JS localeCompare.
      expect(junction.rows).toHaveLength(2);
      expect(junction.rows).toEqual(
        expect.arrayContaining([
          { source_id: sourceA.id, target_id: targetX.id },
          { source_id: sourceB.id, target_id: targetX.id },
        ])
      );
    } finally {
      await sourceGate?.release();
      await junctionGate?.release();
      await Promise.allSettled(requests);
      await dropJunctionGate(ctx, fixture, junctionNames);
      await dropGate(ctx, fixture, sourceNames);
    }
  }, 60_000);
});
