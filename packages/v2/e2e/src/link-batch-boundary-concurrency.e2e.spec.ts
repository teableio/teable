/* eslint-disable @typescript-eslint/naming-convention */
import { setTimeout as delay } from 'node:timers/promises';
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const EXPLICIT_BATCH_SIZE = 1_000;
const BOUNDARY_RECORD_COUNT = EXPLICIT_BATCH_SIZE + 1;
const WAIT_TIMEOUT_MS = 15_000;

type RecordRef = { id: string };
type ApiResult = { status: number; body: unknown };

type OneManyBoundaryFixture = {
  parentTableId: string;
  childTableId: string;
  parentTitleFieldId: string;
  childrenFieldId: string;
  parentFieldId: string;
  childDbTableName: string;
  ownerColumn: string;
  parents: RecordRef[];
  child: RecordRef;
};

type ManyOneConcurrencyFixture = {
  sourceTableId: string;
  sourceTitleFieldId: string;
  linkFieldId: string;
  sourceDbTableName: string;
  sourceRelationOid: number;
  sourceTitleColumn: string;
  linkForeignKeyColumn: string;
  sourceA: RecordRef;
  sourceB: RecordRef;
  targetX: RecordRef;
  targetY: RecordRef;
};

type HeldGate = {
  pid: number;
  release(): Promise<void>;
};

type Instrumentation = {
  functionName: string;
  sequenceName: string;
  triggerName: string;
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

const createRecordsInChunks = async (
  ctx: SharedTestContext,
  tableId: string,
  titleFieldId: string,
  count: number,
  prefix: string
): Promise<RecordRef[]> => {
  const created: RecordRef[] = [];
  for (let offset = 0; offset < count; offset += 250) {
    const batchSize = Math.min(250, count - offset);
    created.push(
      ...(await ctx.createRecords(
        tableId,
        Array.from({ length: batchSize }, (_, index) => ({
          fields: { [titleFieldId]: `${prefix} ${offset + index}` },
        }))
      ))
    );
  }
  return created;
};

const createOneManyBoundaryFixture = async (
  ctx: SharedTestContext
): Promise<OneManyBoundaryFixture> => {
  const childTitleFieldId = `fld${getRandomString(16)}`;
  const children = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Boundary children ${getRandomString(8)}`,
    fields: [{ id: childTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const childMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', children.id)
    .executeTakeFirstOrThrow();

  const parentTitleFieldId = `fld${getRandomString(16)}`;
  const parentsTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Boundary parents ${getRandomString(8)}`,
    fields: [{ id: parentTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });

  const childrenFieldId = `fld${getRandomString(16)}`;
  const parentFieldId = `fld${getRandomString(16)}`;
  const ownerColumn = `__fk_${parentFieldId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: parentsTable.id,
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

  const parents = await createRecordsInChunks(
    ctx,
    parentsTable.id,
    parentTitleFieldId,
    BOUNDARY_RECORD_COUNT,
    'Boundary parent'
  );
  const child = await ctx.createRecord(children.id, { [childTitleFieldId]: 'Transferred child' });

  return {
    parentTableId: parentsTable.id,
    childTableId: children.id,
    parentTitleFieldId,
    childrenFieldId,
    parentFieldId,
    childDbTableName: childMeta.db_table_name,
    ownerColumn,
    parents,
    child,
  };
};

const createManyOneConcurrencyFixture = async (
  ctx: SharedTestContext
): Promise<ManyOneConcurrencyFixture> => {
  const targetTitleFieldId = `fld${getRandomString(16)}`;
  const targets = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Mixed batch targets ${getRandomString(8)}`,
    fields: [{ id: targetTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const [targetX, targetY] = await ctx.createRecords(targets.id, [
    { fields: { [targetTitleFieldId]: 'Target X' } },
    { fields: { [targetTitleFieldId]: 'Target Y' } },
  ]);
  if (!targetX || !targetY) throw new Error('Missing manyOne target records');

  const sourceTitleFieldId = `fld${getRandomString(16)}`;
  const linkFieldId = `fld${getRandomString(16)}`;
  const sources = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Mixed batch sources ${getRandomString(8)}`,
    fields: [
      { id: sourceTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
      {
        id: linkFieldId,
        name: 'Target',
        type: 'link',
        options: {
          relationship: 'manyOne',
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
  const titleMeta = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('id', '=', sourceTitleFieldId)
    .executeTakeFirstOrThrow();
  if (!titleMeta.db_field_name) throw new Error('Missing source title database column');

  const [sourceA, sourceB] = await ctx.createRecords(sources.id, [
    { fields: { [sourceTitleFieldId]: 'Source A' } },
    { fields: { [sourceTitleFieldId]: 'Source B' } },
  ]);
  if (!sourceA || !sourceB) throw new Error('Missing manyOne source records');
  const sourceRelation = await sql<{ relation_oid: number }>`
    SELECT tableoid::int AS relation_oid
    FROM ${sql.table(sourceMeta.db_table_name)}
    WHERE __id = ${sourceA.id}
  `.execute(ctx.testContainer.db);
  const sourceRelationOid = sourceRelation.rows[0]?.relation_oid;
  if (sourceRelationOid === undefined) throw new Error('Missing source relation OID');

  return {
    sourceTableId: sources.id,
    sourceTitleFieldId,
    linkFieldId,
    sourceDbTableName: sourceMeta.db_table_name,
    sourceRelationOid,
    sourceTitleColumn: titleMeta.db_field_name,
    linkForeignKeyColumn: `__fk_${linkFieldId}`,
    sourceA,
    sourceB,
    targetX,
    targetY,
  };
};

const instrumentationNames = (): Instrumentation => {
  const prefix = `t8242_boundary_${getRandomString(10).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    sequenceName: `${prefix}_attempts`,
    triggerName: `${prefix}_gate`,
    gateKey: `${prefix}:before-main-update`,
  };
};

const installInstrumentation = async (
  ctx: SharedTestContext,
  fixture: ManyOneConcurrencyFixture,
  names: Instrumentation
) => {
  await sql`CREATE SEQUENCE ${sql.id('public', names.sequenceName)}`.execute(ctx.testContainer.db);
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM nextval(TG_ARGV[0]::regclass);
      PERFORM pg_advisory_xact_lock_shared(
        ('x' || substr(md5(TG_ARGV[1]), 1, 16))::bit(64)::bigint
      );
      RETURN NULL;
    END;
    $$
  `.execute(ctx.testContainer.db);
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    BEFORE UPDATE OF ${sql.id(fixture.sourceTitleColumn)}
    ON ${sql.table(fixture.sourceDbTableName)}
    FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.sequenceName}`)},
      ${sql.lit(names.gateKey)}
    )
  `.execute(ctx.testContainer.db);
};

const dropInstrumentation = async (
  ctx: SharedTestContext,
  fixture: ManyOneConcurrencyFixture,
  names: Instrumentation
) => {
  await sql`DROP TRIGGER IF EXISTS ${sql.id(names.triggerName)} ON ${sql.table(fixture.sourceDbTableName)}`.execute(
    ctx.testContainer.db
  );
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
  await sql`DROP SEQUENCE IF EXISTS ${sql.id('public', names.sequenceName)}`.execute(
    ctx.testContainer.db
  );
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

const waitForFirstGateWaiter = async (
  ctx: SharedTestContext,
  fixture: ManyOneConcurrencyFixture,
  gatePid: number
): Promise<number> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await sql<{ pid: number }>`
      SELECT activity.pid::int AS pid
      FROM pg_stat_activity AS activity
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND activity.wait_event_type = 'Lock'
        AND ${gatePid} = ANY(pg_blocking_pids(activity.pid))
        AND EXISTS (
          SELECT 1
          FROM pg_locks AS relation_lock
          WHERE relation_lock.pid = activity.pid
            AND relation_lock.relation = ${fixture.sourceRelationOid}::oid
        )
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return result.rows[0]!.pid;
    expect(result.rows, 'unexpected additional first-request gate waiters').toHaveLength(0);
    await delay(20);
  }
  throw new Error('First mixed batch did not reach the PostgreSQL main-UPDATE gate');
};

const waitForSecondBlockedBackend = async (
  ctx: SharedTestContext,
  fixture: ManyOneConcurrencyFixture,
  gatePid: number,
  firstRequestPid: number
): Promise<{ pid: number; blockers: number[] }> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await sql<{ pid: number; blockers: number[] }>`
      SELECT activity.pid::int AS pid, pg_blocking_pids(activity.pid)::int[] AS blockers
      FROM pg_stat_activity AS activity
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND activity.pid <> ${firstRequestPid}
        AND activity.wait_event_type = 'Lock'
        AND (
          ${gatePid} = ANY(pg_blocking_pids(activity.pid))
          OR ${firstRequestPid} = ANY(pg_blocking_pids(activity.pid))
        )
        AND EXISTS (
          SELECT 1
          FROM pg_locks AS relation_lock
          WHERE relation_lock.pid = activity.pid
            AND relation_lock.relation = ${fixture.sourceRelationOid}::oid
        )
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return result.rows[0]!;
    expect(result.rows, 'unexpected additional second-request lock waiters').toHaveLength(0);
    await delay(20);
  }
  throw new Error('Second mixed batch did not reach the PostgreSQL synchronization boundary');
};

const sequenceCalls = async (ctx: SharedTestContext, sequenceName: string): Promise<number> => {
  const result = await sql<{ last_value: string | number; is_called: boolean }>`
    SELECT last_value, is_called FROM ${sql.id('public', sequenceName)}
  `.execute(ctx.testContainer.db);
  const row = result.rows[0]!;
  return row.is_called ? Number(row.last_value) : 0;
};

describe('link explicit-batch boundaries and mixed-update lock ordering (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('uses the complete 1001-record intent when claim and release straddle the internal boundary', async () => {
    const fixture = await createOneManyBoundaryFixture(ctx);
    const claimant = fixture.parents[0]!;
    const oldOwner = fixture.parents[BOUNDARY_RECORD_COUNT - 1]!;
    const fillers = fixture.parents.slice(1, BOUNDARY_RECORD_COUNT - 1);

    await ctx.updateRecord(fixture.parentTableId, oldOwner.id, {
      [fixture.childrenFieldId]: [{ id: fixture.child.id }],
    });
    await ctx.drainOutbox();

    const result = await ctx.updateRecords({
      tableId: fixture.parentTableId,
      records: [
        {
          id: claimant.id,
          fields: { [fixture.childrenFieldId]: [{ id: fixture.child.id }] },
        },
        ...fillers.map((record, index) => ({
          id: record.id,
          fields: { [fixture.parentTitleFieldId]: `Boundary filler updated ${index}` },
        })),
        {
          id: oldOwner.id,
          fields: { [fixture.childrenFieldId]: [] },
        },
      ],
    });
    expect(result.updatedCount).toBe(BOUNDARY_RECORD_COUNT);
    await ctx.drainOutbox();

    const firstPage = await ctx.listRecordsWithPagination(fixture.parentTableId, {
      limit: EXPLICIT_BATCH_SIZE,
      offset: 0,
    });
    const secondPage = await ctx.listRecordsWithPagination(fixture.parentTableId, {
      limit: EXPLICIT_BATCH_SIZE,
      offset: EXPLICIT_BATCH_SIZE,
    });
    const parents = [...firstPage.records, ...secondPage.records];
    expect(new Set(parents.map(({ id }) => id)).size).toBe(BOUNDARY_RECORD_COUNT);
    expect(linkIds(findRecord(parents, claimant).fields[fixture.childrenFieldId])).toEqual([
      fixture.child.id,
    ]);
    expect(linkIds(findRecord(parents, oldOwner).fields[fixture.childrenFieldId])).toEqual([]);

    const children = await ctx.listRecords(fixture.childTableId);
    expect(singleLinkId(findRecord(children, fixture.child).fields[fixture.parentFieldId])).toBe(
      claimant.id
    );
    const physicalOwner = await sql<{ owner_id: string | null }>`
      SELECT ${sql.id(fixture.ownerColumn)} AS owner_id
      FROM ${sql.table(fixture.childDbTableName)}
      WHERE __id = ${fixture.child.id}
    `.execute(ctx.testContainer.db);
    expect(physicalOwner.rows).toEqual([{ owner_id: claimant.id }]);
  }, 120_000);

  it('serializes two crossed mixed link/value batches without a deadlock transaction retry', async () => {
    const fixture = await createManyOneConcurrencyFixture(ctx);
    const names = instrumentationNames();
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await installInstrumentation(ctx, fixture, names);
      gate = await holdExclusiveGate(ctx, names.gateKey);

      const firstRequest = postUpdateRecords(ctx, fixture.sourceTableId, [
        {
          id: fixture.sourceA.id,
          fields: { [fixture.sourceTitleFieldId]: 'Source A by first request' },
        },
        {
          id: fixture.sourceB.id,
          fields: { [fixture.linkFieldId]: { id: fixture.targetX.id } },
        },
      ]);
      requests.push(firstRequest);
      void Promise.allSettled(requests);
      const firstRequestPid = await waitForFirstGateWaiter(ctx, fixture, gate.pid);

      const secondRequest = postUpdateRecords(ctx, fixture.sourceTableId, [
        {
          id: fixture.sourceA.id,
          fields: { [fixture.linkFieldId]: { id: fixture.targetY.id } },
        },
        {
          id: fixture.sourceB.id,
          fields: { [fixture.sourceTitleFieldId]: 'Source B by second request' },
        },
      ]);
      requests.push(secondRequest);
      void Promise.allSettled(requests);
      // Wait for both requests to contend before releasing the main-UPDATE gate.
      // A post-write guard permits the second request to wait at the gate itself;
      // it need not be blocked by a source-row lock held by the first request.
      const secondWaiter = await waitForSecondBlockedBackend(
        ctx,
        fixture,
        gate.pid,
        firstRequestPid
      );
      expect(secondWaiter.pid).not.toBe(firstRequestPid);

      const lockEvidence = await sql<{
        pid: number;
        blockers: number[];
        lock_type: string;
        mode: string;
        granted: boolean;
      }>`
        SELECT locks.pid::int AS pid,
          pg_blocking_pids(locks.pid)::int[] AS blockers,
          locks.locktype AS lock_type,
          locks.mode,
          locks.granted
        FROM pg_locks AS locks
        WHERE locks.pid IN (${firstRequestPid}, ${secondWaiter.pid})
          AND locks.locktype IN ('advisory', 'transactionid', 'tuple')
        ORDER BY locks.pid, locks.locktype, locks.granted
      `.execute(ctx.testContainer.db);

      await gate.release();
      const results = await Promise.all(requests);
      const attempts = await sequenceCalls(ctx, names.sequenceName);
      const evidence = JSON.stringify({
        results,
        attempts,
        secondWaiter,
        locksBeforeRelease: lockEvidence.rows,
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
      expect.soft(attempts, `deadlock retry detected: ${evidence}`).toBe(2);

      await ctx.drainOutbox();
      const sources = await ctx.listRecords(fixture.sourceTableId);
      const sourceA = findRecord(sources, fixture.sourceA);
      const sourceB = findRecord(sources, fixture.sourceB);
      expect(sourceA.fields[fixture.sourceTitleFieldId]).toBe('Source A by first request');
      expect(singleLinkId(sourceA.fields[fixture.linkFieldId])).toBe(fixture.targetY.id);
      expect(sourceB.fields[fixture.sourceTitleFieldId]).toBe('Source B by second request');
      expect(singleLinkId(sourceB.fields[fixture.linkFieldId])).toBe(fixture.targetX.id);

      const physicalLinks = await sql<{ record_id: string; target_id: string | null }>`
        SELECT __id AS record_id, ${sql.id(fixture.linkForeignKeyColumn)} AS target_id
        FROM ${sql.table(fixture.sourceDbTableName)}
        WHERE __id IN (${fixture.sourceA.id}, ${fixture.sourceB.id})
      `.execute(ctx.testContainer.db);
      expect(new Map(physicalLinks.rows.map((row) => [row.record_id, row.target_id]))).toEqual(
        new Map<string, string | null>([
          [fixture.sourceA.id, fixture.targetY.id],
          [fixture.sourceB.id, fixture.targetX.id],
        ])
      );
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropInstrumentation(ctx, fixture, names);
    }
  }, 60_000);
});
