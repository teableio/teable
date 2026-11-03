/* eslint-disable @typescript-eslint/naming-convention */
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const POSTGRES_SETUP_TIMEOUT_MS = 120_000;
const WAITER_TIMEOUT_MS = 10_000;

const isPgliteConnection = () => {
  const connectionString =
    process.env.TEABLE_V2_TEST_DATABASE_URL ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL;

  return connectionString?.startsWith('pglite://') || connectionString === 'memory://';
};

const delay = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

type HeldRowLock = {
  holderPid: number;
  release(): Promise<void>;
};

const holdForeignRecordRowLock = async (
  ctx: SharedTestContext,
  tableName: string,
  recordId: string
): Promise<HeldRowLock> => {
  const acquired = Promise.withResolvers<number>();
  const releaseGate = Promise.withResolvers<void>();
  let released = false;

  const holder = ctx.testContainer.db
    .transaction()
    .execute(async (trx) => {
      const result = await sql<{ holder_pid: number }>`
        SELECT pg_backend_pid()::int AS holder_pid
        FROM ${sql.table(tableName)}
        WHERE ${sql.ref('__id')} = ${recordId}
        FOR NO KEY UPDATE
      `.execute(trx);
      const holderPid = result.rows[0]?.holder_pid;
      if (holderPid === undefined) {
        throw new Error(`Foreign record ${recordId} was not found while acquiring its row lock`);
      }
      acquired.resolve(Number(holderPid));
      await releaseGate.promise;
    })
    .catch((error: unknown) => {
      acquired.reject(error);
      throw error;
    });

  const holderPid = await acquired.promise;
  return {
    holderPid,
    release: async () => {
      if (!released) {
        released = true;
        releaseGate.resolve();
      }
      await holder;
    },
  };
};

const blockedByHolderCount = async (ctx: SharedTestContext, holderPid: number): Promise<number> => {
  const result = await sql<{ count: number }>`
    WITH RECURSIVE blocked(pid) AS (
      SELECT activity.pid
      FROM pg_stat_activity AS activity
      WHERE ${holderPid} = ANY(pg_blocking_pids(activity.pid))

      UNION

      SELECT activity.pid
      FROM pg_stat_activity AS activity
      JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
    )
    SELECT count(*)::int AS count
    FROM blocked
  `.execute(ctx.testContainer.db);

  return Number(result.rows[0]?.count ?? 0);
};

const waitForBlockedRowLockRequests = async (
  ctx: SharedTestContext,
  holderPid: number,
  expectedCount: number
): Promise<void> => {
  const deadline = Date.now() + WAITER_TIMEOUT_MS;
  let count = 0;

  while (Date.now() < deadline) {
    count = await blockedByHolderCount(ctx, holderPid);
    if (count >= expectedCount) return;
    await delay(25);
  }

  expect(
    count,
    'both updates should be blocked by the foreign-record row lock'
  ).toBeGreaterThanOrEqual(expectedCount);
};

type RawUpdateResult = {
  response: Response;
  rawBody: unknown;
};

const updateRecordRaw = async (
  ctx: SharedTestContext,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<RawUpdateResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, recordId, fields }),
  });
  const rawBody = await response.json().catch(() => undefined);
  return { response, rawBody };
};

type Contender = { id: string };

type ContestedClaim = {
  contender: Contender;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
};

type ContestResults = readonly [RawUpdateResult, RawUpdateResult];

const runContestedClaims = async (params: {
  ctx: SharedTestContext;
  childDbTableName: string;
  childRecordId: string;
  claims: readonly [ContestedClaim, ContestedClaim];
}): Promise<ContestResults> => {
  const { ctx, childDbTableName, childRecordId, claims } = params;
  const heldLock = await holdForeignRecordRowLock(ctx, childDbTableName, childRecordId);
  const requests = claims.map((claim) =>
    updateRecordRaw(ctx, claim.tableId, claim.recordId, claim.fields)
  ) as [Promise<RawUpdateResult>, Promise<RawUpdateResult>];

  try {
    await waitForBlockedRowLockRequests(ctx, heldLock.holderPid, requests.length);
    await heldLock.release();
    return await Promise.all(requests);
  } finally {
    await heldLock.release();
    await Promise.allSettled(requests);
  }
};

const assertClientRejection = (result: RawUpdateResult) => {
  expect(result.response.status).toBeGreaterThanOrEqual(400);
  expect(result.response.status).toBeLessThan(500);
  expect(JSON.stringify(result.rawBody).toLowerCase()).toMatch(/already|conflict|link|validation/);
};

type OneManyFixture = {
  childBaseId: string;
  parentTableId: string;
  parentTitleFieldId: string;
  childTableId: string;
  childTitleFieldId: string;
  oneManyFieldId: string;
  symmetricFieldId: string;
  childDbTableName: string;
  childOwnerColumnName: string;
};

const createOneManyFixture = async (
  ctx: SharedTestContext,
  scope: string,
  crossBase: boolean
): Promise<OneManyFixture> => {
  let childBaseId = ctx.baseId;
  if (crossBase) {
    childBaseId = `bse${getRandomString(16)}`;
    const spaceId = `spc${getRandomString(16)}`;
    await ctx.testContainer.db
      .insertInto('space')
      .values({
        id: spaceId,
        name: `${scope} space`,
        created_by: 'system',
      })
      .execute();
    await ctx.testContainer.db
      .insertInto('base')
      .values({
        id: childBaseId,
        space_id: spaceId,
        name: `${scope} base`,
        order: 1,
        created_by: 'system',
      })
      .execute();
  }

  const childTitleFieldId = `fld${getRandomString(16)}`;
  const childTable = await ctx.createTable({
    baseId: childBaseId,
    name: `${scope} orders ${getRandomString(8)}`,
    fields: [{ type: 'singleLineText', id: childTitleFieldId, name: 'Order', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const childMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', childTable.id)
    .executeTakeFirstOrThrow();

  const parentTitleFieldId = `fld${getRandomString(16)}`;
  const parentTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `${scope} parents ${getRandomString(8)}`,
    fields: [{ type: 'singleLineText', id: parentTitleFieldId, name: 'Parent', isPrimary: true }],
    views: [{ type: 'grid' }],
  });

  const oneManyFieldId = `fld${getRandomString(16)}`;
  const symmetricFieldId = `fld${getRandomString(16)}`;
  const childOwnerColumnName = `__fk_${symmetricFieldId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: parentTable.id,
    field: {
      type: 'link',
      id: oneManyFieldId,
      name: 'Orders',
      options: {
        ...(crossBase ? { baseId: childBaseId } : {}),
        relationship: 'oneMany',
        foreignTableId: childTable.id,
        lookupFieldId: childTitleFieldId,
        isOneWay: false,
        symmetricFieldId,
        fkHostTableName: childMeta.db_table_name,
        selfKeyName: childOwnerColumnName,
        foreignKeyName: '__id',
      },
    },
  });

  return {
    childBaseId,
    parentTableId: parentTable.id,
    parentTitleFieldId,
    childTableId: childTable.id,
    childTitleFieldId,
    oneManyFieldId,
    symmetricFieldId,
    childDbTableName: childMeta.db_table_name,
    childOwnerColumnName,
  };
};

const linkRecordIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('id' in item)) return [];
    const id = item.id;
    return typeof id === 'string' ? [id] : [];
  });
};

const assertConvergedOwnership = async (params: {
  ctx: SharedTestContext;
  fixture: OneManyFixture;
  childRecordId: string;
  contenders: readonly [Contender, Contender];
  successfulOwnerIds: ReadonlyArray<string>;
}) => {
  const { ctx, fixture, childRecordId, contenders, successfulOwnerIds } = params;
  await ctx.drainOutbox();

  const ownerResult = await sql<{ owner_id: string | null }>`
    SELECT ${sql.ref(fixture.childOwnerColumnName)} AS owner_id
    FROM ${sql.table(fixture.childDbTableName)}
    WHERE ${sql.ref('__id')} = ${childRecordId}
  `.execute(ctx.testContainer.db);
  const ownerId = ownerResult.rows[0]?.owner_id;
  if (typeof ownerId !== 'string') {
    throw new Error(`Contested child ${childRecordId} has no physical owner after the race`);
  }
  expect(successfulOwnerIds).toContain(ownerId);

  const winner = contenders.find((contender) => contender.id === ownerId);
  const loser = contenders.find((contender) => contender.id !== ownerId);
  if (!winner || !loser) {
    throw new Error(`Unexpected physical owner ${ownerId} for contested child ${childRecordId}`);
  }

  const parents = await ctx.listRecords(fixture.parentTableId);
  const winnerAfter = parents.find((record) => record.id === winner.id);
  const loserAfter = parents.find((record) => record.id === loser.id);
  expect(linkRecordIds(winnerAfter?.fields[fixture.oneManyFieldId])).toEqual([childRecordId]);
  expect(linkRecordIds(loserAfter?.fields[fixture.oneManyFieldId])).toEqual([]);
  expect(
    parents.filter((record) =>
      linkRecordIds(record.fields[fixture.oneManyFieldId]).includes(childRecordId)
    )
  ).toHaveLength(1);

  const children = await ctx.listRecords(fixture.childTableId, {
    baseId: fixture.childBaseId,
  });
  const childAfter = children.find((record) => record.id === childRecordId);
  expect(childAfter?.fields[fixture.symmetricFieldId]).toEqual(
    expect.objectContaining({ id: winner.id })
  );
};

describe.skipIf(isPgliteConnection())('oneMany concurrent ownership (postgres e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, POSTGRES_SETUP_TIMEOUT_MS);

  const verifyConcurrentClaim = async (crossBase: boolean) => {
    const scope = crossBase ? 'Cross-base concurrency' : 'Same-base concurrency';
    const fixture = await createOneManyFixture(ctx, scope, crossBase);
    const child = await ctx.createRecord(fixture.childTableId, {
      [fixture.childTitleFieldId]: `${scope} contested order`,
    });
    const parentA = await ctx.createRecord(fixture.parentTableId, {
      [fixture.parentTitleFieldId]: `${scope} parent A`,
    });
    const parentB = await ctx.createRecord(fixture.parentTableId, {
      [fixture.parentTitleFieldId]: `${scope} parent B`,
    });
    await ctx.drainOutbox();

    const parentClaim = (parent: Contender): ContestedClaim => ({
      contender: parent,
      tableId: fixture.parentTableId,
      recordId: parent.id,
      fields: { [fixture.oneManyFieldId]: [{ id: child.id }] },
    });
    // In the cross-base case, contend through opposite link endpoints so the parent-base
    // oneMany write and child-base symmetric manyOne write block on the same physical row.
    const claims: [ContestedClaim, ContestedClaim] = crossBase
      ? [
          parentClaim({ id: parentA.id }),
          {
            contender: { id: parentB.id },
            tableId: fixture.childTableId,
            recordId: child.id,
            fields: { [fixture.symmetricFieldId]: { id: parentB.id } },
          },
        ]
      : [parentClaim({ id: parentA.id }), parentClaim({ id: parentB.id })];

    const results = await runContestedClaims({
      ctx,
      childDbTableName: fixture.childDbTableName,
      childRecordId: child.id,
      claims,
    });
    const successfulOwnerIds = results.flatMap((result, index) =>
      result.response.ok ? [claims[index]!.contender.id] : []
    );
    const rejectedResults = results.filter((result) => !result.response.ok);

    expect(successfulOwnerIds.length).toBeGreaterThanOrEqual(1);
    if (!crossBase) {
      expect(successfulOwnerIds, 'same-direction claims must have one winner').toHaveLength(1);
      expect(rejectedResults, 'same-direction claims must reject one loser').toHaveLength(1);
    }
    rejectedResults.forEach(assertClientRejection);

    await assertConvergedOwnership({
      ctx,
      fixture,
      childRecordId: child.id,
      contenders: [{ id: parentA.id }, { id: parentB.id }],
      successfulOwnerIds,
    });
  };

  it('serializes two parents claiming the same order and leaves one consistent owner', async () => {
    await verifyConcurrentClaim(false);
  }, 40_000);

  it('converges opposite-side cross-base oneMany claims without stale link caches', async () => {
    await verifyConcurrentClaim(true);
  }, 40_000);
});
