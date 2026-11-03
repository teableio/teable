/* eslint-disable @typescript-eslint/naming-convention */
import { setTimeout as delay } from 'node:timers/promises';
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const WAIT_TIMEOUT_MS = 15_000;

type RecordRef = { id: string };
type ApiResult = { status: number; body: unknown };
type HeldGate = { pid: number; release(): Promise<void> };

type Fixture = {
  parentTableId: string;
  childTableId: string;
  parentDbTableName: string;
  childDbTableName: string;
  parentTitleFieldId: string;
  markerFieldId: string;
  markerColumn: string;
  fieldAId: string;
  fieldBId: string;
  reverseAId: string;
  reverseBId: string;
  ownerAColumn: string;
  ownerBColumn: string;
  childX: RecordRef;
  childY: RecordRef;
};

type Instrumentation = {
  functionName: string;
  attemptSequence: string;
  attemptTrigger: string;
  gateTrigger: string;
  gateKey: string;
};

const advisoryKey = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

const post = async (
  ctx: SharedTestContext,
  endpoint: 'createRecord' | 'updateRecord',
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
  recordId: string
) => {
  const record = records.find(({ id }) => id === recordId);
  if (!record) throw new Error(`Missing record ${recordId}`);
  return record;
};

const findRecordByTitle = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  titleFieldId: string,
  title: string
) => {
  const record = records.find(({ fields }) => fields[titleFieldId] === title);
  if (!record) throw new Error(`Missing record titled ${title}`);
  return record;
};

const createFixture = async (ctx: SharedTestContext, scope: string): Promise<Fixture> => {
  const childTitleFieldId = `fld${getRandomString(16)}`;
  const children = await ctx.createTable({
    baseId: ctx.baseId,
    name: `${scope} children ${getRandomString(8)}`,
    fields: [{ id: childTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const childMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', children.id)
    .executeTakeFirstOrThrow();
  const [childX, childY] = await ctx.createRecords(children.id, [
    { fields: { [childTitleFieldId]: 'X' } },
    { fields: { [childTitleFieldId]: 'Y' } },
  ]);
  if (!childX || !childY) throw new Error('Missing X/Y child records');

  const parentTitleFieldId = `fld${getRandomString(16)}`;
  const markerFieldId = `fld${getRandomString(16)}`;
  const parents = await ctx.createTable({
    baseId: ctx.baseId,
    name: `${scope} parents ${getRandomString(8)}`,
    fields: [
      { id: parentTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: markerFieldId, name: 'Marker', type: 'singleLineText' },
    ],
    views: [{ type: 'grid' }],
  });
  const parentMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', parents.id)
    .executeTakeFirstOrThrow();
  const markerMeta = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('id', '=', markerFieldId)
    .executeTakeFirstOrThrow();
  if (!markerMeta.db_field_name) throw new Error('Missing marker database column');

  const fieldAId = `fld${getRandomString(16)}`;
  const reverseAId = `fld${getRandomString(16)}`;
  const ownerAColumn = `__fk_${reverseAId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: parents.id,
    field: {
      id: fieldAId,
      name: 'Children A',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: children.id,
        lookupFieldId: childTitleFieldId,
        isOneWay: false,
        symmetricFieldId: reverseAId,
        fkHostTableName: childMeta.db_table_name,
        selfKeyName: ownerAColumn,
        foreignKeyName: '__id',
      },
    },
  });

  const fieldBId = `fld${getRandomString(16)}`;
  const reverseBId = `fld${getRandomString(16)}`;
  const ownerBColumn = `__fk_${reverseBId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: parents.id,
    field: {
      id: fieldBId,
      name: 'Children B',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: children.id,
        lookupFieldId: childTitleFieldId,
        isOneWay: false,
        symmetricFieldId: reverseBId,
        fkHostTableName: childMeta.db_table_name,
        selfKeyName: ownerBColumn,
        foreignKeyName: '__id',
      },
    },
  });

  return {
    parentTableId: parents.id,
    childTableId: children.id,
    parentDbTableName: parentMeta.db_table_name,
    childDbTableName: childMeta.db_table_name,
    parentTitleFieldId,
    markerFieldId,
    markerColumn: markerMeta.db_field_name,
    fieldAId,
    fieldBId,
    reverseAId,
    reverseBId,
    ownerAColumn,
    ownerBColumn,
    childX,
    childY,
  };
};

const instrumentationNames = (scope: string): Instrumentation => {
  const prefix = `t8242_${scope}_${getRandomString(8).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    attemptSequence: `${prefix}_attempt`,
    attemptTrigger: `${prefix}_attempt`,
    gateTrigger: `${prefix}_gate`,
    gateKey: `${prefix}:after-first-child-write`,
  };
};

const createInstrumentationObjects = async (
  ctx: SharedTestContext,
  names: Instrumentation
): Promise<void> => {
  await sql`CREATE SEQUENCE ${sql.id('public', names.attemptSequence)}`.execute(
    ctx.testContainer.db
  );
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_LEVEL = 'STATEMENT' THEN
        PERFORM nextval(TG_ARGV[0]::regclass);
        RETURN NULL;
      END IF;
      PERFORM pg_advisory_xact_lock(
        ('x' || substr(md5(TG_ARGV[0]), 1, 16))::bit(64)::bigint
      );
      RETURN NEW;
    END;
    $$
  `.execute(ctx.testContainer.db);
};

const installUpdateInstrumentation = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  parentA: RecordRef,
  names: Instrumentation
): Promise<void> => {
  await createInstrumentationObjects(ctx, names);
  // The marker is part of both API updates, so this non-transactional sequence
  // counts whole Unit-of-Work attempts, including attempts later rolled back.
  await sql`
    CREATE TRIGGER ${sql.id(names.attemptTrigger)}
    BEFORE UPDATE OF ${sql.id(fixture.markerColumn)}
    ON ${sql.table(fixture.parentDbTableName)}
    FOR EACH STATEMENT
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.attemptSequence}`)}
    )
  `.execute(ctx.testContainer.db);
  // T1 has cleared A:x and still owns x's row lock. Without a common physical
  // row order, T2 can now clear B:y and wait on x while T1 later waits on y.
  await sql`
    CREATE TRIGGER ${sql.id(names.gateTrigger)}
    AFTER UPDATE OF ${sql.id(fixture.ownerAColumn)}
    ON ${sql.table(fixture.childDbTableName)}
    FOR EACH ROW WHEN (
      NEW.__id = ${sql.lit(fixture.childX.id)}
      AND OLD.${sql.id(fixture.ownerAColumn)} = ${sql.lit(parentA.id)}
      AND NEW.${sql.id(fixture.ownerAColumn)} IS NULL
    )
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(${sql.lit(names.gateKey)})
  `.execute(ctx.testContainer.db);
};

const installInsertInstrumentation = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await createInstrumentationObjects(ctx, names);
  // Source INSERT precedes the target-lock/validation phase, so nextval also
  // counts attempts that deadlock before any child FK UPDATE can execute.
  await sql`
    CREATE TRIGGER ${sql.id(names.attemptTrigger)}
    BEFORE INSERT ON ${sql.table(fixture.parentDbTableName)}
    FOR EACH STATEMENT
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.attemptSequence}`)}
    )
  `.execute(ctx.testContainer.db);
};

const dropInstrumentation = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await sql`
    DROP TRIGGER IF EXISTS ${sql.id(names.gateTrigger)}
    ON ${sql.table(fixture.childDbTableName)}
  `.execute(ctx.testContainer.db);
  await sql`
    DROP TRIGGER IF EXISTS ${sql.id(names.attemptTrigger)}
    ON ${sql.table(fixture.parentDbTableName)}
  `.execute(ctx.testContainer.db);
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
  await sql`DROP SEQUENCE IF EXISTS ${sql.id('public', names.attemptSequence)}`.execute(
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

const holdChildRowGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  recordId: string
): Promise<HeldGate> => {
  const acquired = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const transaction = ctx.testContainer.db.transaction().execute(async (trx) => {
    const result = await sql<{ pid: number }>`
      SELECT pg_backend_pid()::int AS pid
      FROM ${sql.table(fixture.childDbTableName)}
      WHERE __id = ${recordId}
      FOR NO KEY UPDATE
    `.execute(trx);
    if (result.rows.length !== 1) throw new Error(`Missing child row gate ${recordId}`);
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

const waitForInsertLockWaiter = async (
  ctx: SharedTestContext,
  gatePid: number,
  excludedPid = -1
): Promise<number> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await sql<{ pid: number }>`
      WITH RECURSIVE blocked(pid) AS (
        SELECT activity.pid
        FROM pg_stat_activity AS activity
        WHERE activity.datname = current_database()
          AND activity.pid <> pg_backend_pid()
          AND activity.state = 'active'
          AND activity.wait_event_type = 'Lock'
          AND ${gatePid} = ANY(pg_blocking_pids(activity.pid))

        UNION

        SELECT activity.pid
        FROM pg_stat_activity AS activity
        JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
        WHERE activity.datname = current_database()
          AND activity.pid <> pg_backend_pid()
          AND activity.state = 'active'
          AND activity.wait_event_type = 'Lock'
      )
      SELECT pid::int AS pid
      FROM blocked
      WHERE pid <> ${excludedPid}
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return result.rows[0]!.pid;
    expect(result.rows, 'only the next insert should join the gate blocking chain').toHaveLength(0);
    // T1 may wait on T2's shared target advisory lock before reaching its own
    // row-lock query. Both paths must be descendants of the real y-row gate.
    await delay(20);
  }
  throw new Error('PostgreSQL did not observe the insert in the row-gate blocking chain');
};

const sequenceCalls = async (ctx: SharedTestContext, sequence: string): Promise<number> => {
  const result = await sql<{ last_value: string | number; is_called: boolean }>`
    SELECT last_value, is_called FROM ${sql.id('public', sequence)}
  `.execute(ctx.testContainer.db);
  const row = result.rows[0]!;
  return row.is_called ? Number(row.last_value) : 0;
};

const readPhysicalOwners = async (ctx: SharedTestContext, fixture: Fixture) => {
  const result = await sql<{ record_id: string; owner_a: string | null; owner_b: string | null }>`
    SELECT
      __id AS record_id,
      ${sql.id(fixture.ownerAColumn)} AS owner_a,
      ${sql.id(fixture.ownerBColumn)} AS owner_b
    FROM ${sql.table(fixture.childDbTableName)}
    WHERE __id IN (${fixture.childX.id}, ${fixture.childY.id})
    ORDER BY __id
  `.execute(ctx.testContainer.db);
  return new Map(result.rows.map((row) => [row.record_id, [row.owner_a, row.owner_b] as const]));
};

const expectSuccessfulRequests = (
  results: ApiResult[],
  attempts: number,
  successStatus: 200 | 201
): void => {
  const evidence = JSON.stringify({ results, attempts });
  expect
    .soft(
      results.map(({ status }) => status),
      evidence
    )
    .toEqual([successStatus, successStatus]);
  expect
    .soft(
      results.map(({ body }) => body),
      evidence
    )
    .toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
  expect.soft(attempts, `transaction retries are not acceptable: ${evidence}`).toBe(2);
};

describe('oneMany cross-field physical lock order (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('updates independent oneMany fields with crossed clear/claim rows without retrying', async () => {
    const fixture = await createFixture(ctx, 'Cross-field update');
    const parentA = await ctx.createRecord(fixture.parentTableId, {
      [fixture.parentTitleFieldId]: 'Parent A',
      [fixture.markerFieldId]: 'initial A',
      [fixture.fieldAId]: [{ id: fixture.childX.id }],
    });
    const parentB = await ctx.createRecord(fixture.parentTableId, {
      [fixture.parentTitleFieldId]: 'Parent B',
      [fixture.markerFieldId]: 'initial B',
      [fixture.fieldBId]: [{ id: fixture.childY.id }],
    });
    await ctx.drainOutbox();

    expect(await readPhysicalOwners(ctx, fixture)).toEqual(
      new Map<string, readonly [string | null, string | null]>([
        [fixture.childX.id, [parentA.id, null]],
        [fixture.childY.id, [null, parentB.id]],
      ])
    );

    const names = instrumentationNames('cross_update');
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await installUpdateInstrumentation(ctx, fixture, parentA, names);
      gate = await holdGate(ctx, names.gateKey);

      const t1 = post(ctx, 'updateRecord', {
        tableId: fixture.parentTableId,
        recordId: parentA.id,
        fields: {
          [fixture.markerFieldId]: 'T1 committed',
          [fixture.fieldAId]: [{ id: fixture.childY.id }],
        },
      });
      requests.push(t1);
      void Promise.allSettled(requests);
      const t1Pid = await waitForBlockedBackend(ctx, gate.pid, 'T1 at the A:x clear gate');

      const t2 = post(ctx, 'updateRecord', {
        tableId: fixture.parentTableId,
        recordId: parentB.id,
        fields: {
          [fixture.markerFieldId]: 'T2 committed',
          [fixture.fieldBId]: [{ id: fixture.childX.id }],
        },
      });
      requests.push(t2);
      void Promise.allSettled(requests);
      const t2Pid = await waitForBlockedBackend(ctx, t1Pid, 'T2 behind T1 child-row locks');
      expect(t2Pid).not.toBe(t1Pid);

      await gate.release();
      const results = await Promise.all(requests);
      const attempts = await sequenceCalls(ctx, names.attemptSequence);
      expectSuccessfulRequests(results, attempts, 200);

      await ctx.drainOutbox();
      const parents = await ctx.listRecords(fixture.parentTableId);
      const finalParentA = findRecord(parents, parentA.id);
      const finalParentB = findRecord(parents, parentB.id);
      expect(finalParentA.fields[fixture.markerFieldId]).toBe('T1 committed');
      expect(finalParentB.fields[fixture.markerFieldId]).toBe('T2 committed');
      expect(linkIds(finalParentA.fields[fixture.fieldAId])).toEqual([fixture.childY.id]);
      expect(linkIds(finalParentA.fields[fixture.fieldBId])).toEqual([]);
      expect(linkIds(finalParentB.fields[fixture.fieldAId])).toEqual([]);
      expect(linkIds(finalParentB.fields[fixture.fieldBId])).toEqual([fixture.childX.id]);

      const children = await ctx.listRecords(fixture.childTableId);
      const childX = findRecord(children, fixture.childX.id);
      const childY = findRecord(children, fixture.childY.id);
      expect(singleLinkId(childX.fields[fixture.reverseAId])).toBeUndefined();
      expect(singleLinkId(childY.fields[fixture.reverseAId])).toBe(parentA.id);
      expect(singleLinkId(childX.fields[fixture.reverseBId])).toBe(parentB.id);
      expect(singleLinkId(childY.fields[fixture.reverseBId])).toBeUndefined();
      expect(await readPhysicalOwners(ctx, fixture)).toEqual(
        new Map<string, readonly [string | null, string | null]>([
          [fixture.childX.id, [null, parentB.id]],
          [fixture.childY.id, [parentA.id, null]],
        ])
      );
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropInstrumentation(ctx, fixture, names);
    }
  }, 60_000);

  it('inserts crossed claims through independent oneMany fields without retrying', async () => {
    const fixture = await createFixture(ctx, 'Cross-field insert');
    // Use the database's actual ID order, not creation order or JS collation.
    const orderedChildren = await sql<{ id: string }>`
      SELECT __id AS id
      FROM ${sql.table(fixture.childDbTableName)}
      WHERE __id IN (${fixture.childX.id}, ${fixture.childY.id})
      ORDER BY __id
    `.execute(ctx.testContainer.db);
    expect(orderedChildren.rows).toHaveLength(2);
    [fixture.childX, fixture.childY] = [orderedChildren.rows[0]!, orderedChildren.rows[1]!];
    const names = instrumentationNames('cross_insert');
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await installInsertInstrumentation(ctx, fixture, names);
      gate = await holdChildRowGate(ctx, fixture, fixture.childY.id);

      const t2 = post(ctx, 'createRecord', {
        tableId: fixture.parentTableId,
        fields: {
          [fixture.parentTitleFieldId]: 'Insert T2',
          [fixture.fieldAId]: [{ id: fixture.childY.id }],
          [fixture.fieldBId]: [{ id: fixture.childX.id }],
        },
      });
      requests.push(t2);
      void Promise.allSettled(requests);
      const t2Pid = await waitForInsertLockWaiter(ctx, gate.pid);

      // Field A precedes B. Without earlier serialization, per-field validation
      // lets T1 own x while T2 queues first for y. A common physical-row order
      // instead blocks T1 at x; shared target advisory locks can block it sooner.
      const t1 = post(ctx, 'createRecord', {
        tableId: fixture.parentTableId,
        fields: {
          [fixture.parentTitleFieldId]: 'Insert T1',
          [fixture.fieldAId]: [{ id: fixture.childX.id }],
          [fixture.fieldBId]: [{ id: fixture.childY.id }],
        },
      });
      requests.push(t1);
      void Promise.allSettled(requests);
      const t1Pid = await waitForInsertLockWaiter(ctx, gate.pid, t2Pid);
      expect(t2Pid).not.toBe(t1Pid);
      expect(await sequenceCalls(ctx, names.attemptSequence)).toBe(2);

      // The lock chain proves both transactions are in flight before y opens.
      // Uncoordinated per-field locks close the cycle: T2 owns y/wants x while
      // T1 owns x/wants y. Ordered row locks or earlier shared advisory locks
      // must serialize the requests without relying on a transaction retry.

      await gate.release();
      const results = await Promise.all(requests);
      const attempts = await sequenceCalls(ctx, names.attemptSequence);
      expectSuccessfulRequests(results, attempts, 201);

      await ctx.drainOutbox();
      const parents = await ctx.listRecords(fixture.parentTableId);
      expect(parents).toHaveLength(2);
      const parentT1 = findRecordByTitle(parents, fixture.parentTitleFieldId, 'Insert T1');
      const parentT2 = findRecordByTitle(parents, fixture.parentTitleFieldId, 'Insert T2');
      expect(linkIds(parentT1.fields[fixture.fieldAId])).toEqual([fixture.childX.id]);
      expect(linkIds(parentT1.fields[fixture.fieldBId])).toEqual([fixture.childY.id]);
      expect(linkIds(parentT2.fields[fixture.fieldAId])).toEqual([fixture.childY.id]);
      expect(linkIds(parentT2.fields[fixture.fieldBId])).toEqual([fixture.childX.id]);

      const children = await ctx.listRecords(fixture.childTableId);
      const childX = findRecord(children, fixture.childX.id);
      const childY = findRecord(children, fixture.childY.id);
      expect(singleLinkId(childX.fields[fixture.reverseAId])).toBe(parentT1.id);
      expect(singleLinkId(childY.fields[fixture.reverseAId])).toBe(parentT2.id);
      expect(singleLinkId(childX.fields[fixture.reverseBId])).toBe(parentT2.id);
      expect(singleLinkId(childY.fields[fixture.reverseBId])).toBe(parentT1.id);
      expect(await readPhysicalOwners(ctx, fixture)).toEqual(
        new Map<string, readonly [string | null, string | null]>([
          [fixture.childX.id, [parentT1.id, parentT2.id]],
          [fixture.childY.id, [parentT2.id, parentT1.id]],
        ])
      );
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropInstrumentation(ctx, fixture, names);
    }
  }, 60_000);
});
