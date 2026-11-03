/* eslint-disable @typescript-eslint/naming-convention */
import { setTimeout as delay } from 'node:timers/promises';
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const WAIT_TIMEOUT_MS = 15_000;

const advisoryKey = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

type HeldGate = { pid: number; release(): Promise<void> };

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
  // Attach a rejection handler before awaiting acquisition, including failures before the callback.
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

type ApiResult = { status: number; body: unknown };

const post = async (
  ctx: SharedTestContext,
  endpoint: string,
  payload: Record<string, unknown>
): Promise<ApiResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
};

type Fixture = {
  parentTableId: string;
  childTableId: string;
  parentDbTableName: string;
  childDbTableName: string;
  parentTitleColumn: string;
  parentTitleId: string;
  linkId: string;
  reverseId: string;
  ownerColumn: string;
  rowOrderColumn: string;
  viewId: string;
  parent: { id: string };
  anchor: { id: string };
  childA: { id: string };
  childB: { id: string };
};

const createFixture = async (ctx: SharedTestContext): Promise<Fixture> => {
  const childTitleId = `fld${getRandomString(16)}`;
  const children = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Lock order children ${getRandomString(8)}`,
    fields: [{ id: childTitleId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const childMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', children.id)
    .executeTakeFirstOrThrow();

  const parentTitleId = `fld${getRandomString(16)}`;
  const parents = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Lock order parents ${getRandomString(8)}`,
    fields: [{ id: parentTitleId, name: 'Name', type: 'singleLineText', isPrimary: true }],
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
    .where('id', '=', parentTitleId)
    .executeTakeFirstOrThrow();
  if (!parentTitleMeta.db_field_name) throw new Error('Missing parent title column');

  const linkId = `fld${getRandomString(16)}`;
  const reverseId = `fld${getRandomString(16)}`;
  const ownerColumn = `__fk_${reverseId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: parents.id,
    field: {
      id: linkId,
      name: 'Children',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: children.id,
        lookupFieldId: childTitleId,
        isOneWay: false,
        symmetricFieldId: reverseId,
        fkHostTableName: childMeta.db_table_name,
        selfKeyName: ownerColumn,
        foreignKeyName: '__id',
      },
    },
  });
  const childA = await ctx.createRecord(children.id, { [childTitleId]: 'Child A' });
  const childB = await ctx.createRecord(children.id, { [childTitleId]: 'Child B' });
  const parent = await ctx.createRecord(parents.id, { [parentTitleId]: 'Parent' });
  const anchor = await ctx.createRecord(parents.id, { [parentTitleId]: 'Anchor' });
  const viewId = parents.views[0]!.id;

  // Materialize the lazy order column before installing column-specific triggers.
  const initialOrder = await post(ctx, 'reorderRecords', {
    tableId: parents.id,
    recordIds: [parent.id],
    order: { viewId, anchorId: anchor.id, position: 'after' },
  });
  expect(initialOrder.status, JSON.stringify(initialOrder.body)).toBe(200);
  await ctx.drainOutbox();

  return {
    parentTableId: parents.id,
    childTableId: children.id,
    parentDbTableName: parentMeta.db_table_name,
    childDbTableName: childMeta.db_table_name,
    parentTitleColumn: parentTitleMeta.db_field_name,
    parentTitleId,
    linkId,
    reverseId,
    ownerColumn,
    rowOrderColumn: `__row_${viewId}`,
    viewId,
    parent,
    anchor,
    childA,
    childB,
  };
};

type Instrumentation = {
  functionName: string;
  reorderSequence: string;
  updateSequence: string;
  reorderTrigger: string;
  updateTrigger: string;
  gateTrigger: string;
  gateKey: string;
};

const instrumentationNames = (): Instrumentation => {
  const prefix = `t8242_${getRandomString(12).toLowerCase()}`;
  return {
    functionName: prefix,
    reorderSequence: `${prefix}_reorder`,
    updateSequence: `${prefix}_update`,
    reorderTrigger: `${prefix}_reorder`,
    updateTrigger: `${prefix}_update`,
    gateTrigger: `${prefix}_gate`,
    gateKey: `${prefix}:after-reorder`,
  };
};

const installInstrumentation = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
) => {
  await sql`CREATE SEQUENCE ${sql.id('public', names.reorderSequence)}`.execute(
    ctx.testContainer.db
  );
  await sql`CREATE SEQUENCE ${sql.id('public', names.updateSequence)}`.execute(
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
  // nextval is not rolled back. BEFORE STATEMENT counts attempts even when the
  // UPDATE subsequently loses a deadlock before obtaining its first row lock.
  await sql`
    CREATE TRIGGER ${sql.id(names.reorderTrigger)}
    BEFORE UPDATE OF ${sql.id(fixture.rowOrderColumn)} ON ${sql.table(fixture.parentDbTableName)}
    FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.reorderSequence}`)}
    )
  `.execute(ctx.testContainer.db);
  await sql`
    CREATE TRIGGER ${sql.id(names.updateTrigger)}
    BEFORE UPDATE OF ${sql.id(fixture.parentTitleColumn)} ON ${sql.table(fixture.parentDbTableName)}
    FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.updateSequence}`)}
    )
  `.execute(ctx.testContainer.db);
  // This is a synchronization barrier, not a replacement for either API writer.
  // AFTER ROW guarantees that request A already owns the reordered parent's row.
  await sql`
    CREATE TRIGGER ${sql.id(names.gateTrigger)}
    AFTER UPDATE OF ${sql.id(fixture.rowOrderColumn)} ON ${sql.table(fixture.parentDbTableName)}
    FOR EACH ROW WHEN (
      NEW.__id = ${sql.lit(fixture.parent.id)}
      AND OLD.${sql.id(fixture.rowOrderColumn)} IS DISTINCT FROM NEW.${sql.id(fixture.rowOrderColumn)}
    ) EXECUTE FUNCTION ${sql.id('public', names.functionName)}(${sql.lit(names.gateKey)})
  `.execute(ctx.testContainer.db);
};

const dropInstrumentation = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
) => {
  for (const trigger of [names.gateTrigger, names.updateTrigger, names.reorderTrigger]) {
    await sql`DROP TRIGGER IF EXISTS ${sql.id(trigger)} ON ${sql.table(fixture.parentDbTableName)}`.execute(
      ctx.testContainer.db
    );
  }
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
  for (const sequence of [names.reorderSequence, names.updateSequence]) {
    await sql`DROP SEQUENCE IF EXISTS ${sql.id('public', sequence)}`.execute(ctx.testContainer.db);
  }
};

const sequenceCalls = async (ctx: SharedTestContext, sequence: string) => {
  const result = await sql<{ last_value: string | number; is_called: boolean }>`
    SELECT last_value, is_called FROM ${sql.id('public', sequence)}
  `.execute(ctx.testContainer.db);
  const row = result.rows[0]!;
  return row.is_called ? Number(row.last_value) : 0;
};

describe('oneMany reorder/update lock order (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('commits reorder+link and a concurrent link update without deadlock transaction retries', async () => {
    const fixture = await createFixture(ctx);
    const names = instrumentationNames();
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await installInstrumentation(ctx, fixture, names);
      gate = await holdGate(ctx, names.gateKey);

      // A must change the order and link in one genuine explicit-batch transaction.
      const reorderRequest = post(ctx, 'updateRecords', {
        tableId: fixture.parentTableId,
        records: [
          { id: fixture.parent.id, fields: { [fixture.linkId]: [{ id: fixture.childA.id }] } },
        ],
        order: { viewId: fixture.viewId, anchorId: fixture.anchor.id, position: 'before' },
      });
      requests.push(reorderRequest);
      void Promise.allSettled(requests);
      const reorderPid = await waitForBlockedBackend(
        ctx,
        gate.pid,
        'reorder AFTER ROW trigger gate'
      );

      const updateRequest = post(ctx, 'updateRecord', {
        tableId: fixture.parentTableId,
        recordId: fixture.parent.id,
        fields: {
          [fixture.parentTitleId]: 'Updated parent',
          [fixture.linkId]: [{ id: fixture.childB.id }],
        },
      });
      requests.push(updateRequest);
      void Promise.allSettled(requests);
      const updatePid = await waitForBlockedBackend(
        ctx,
        reorderPid,
        'concurrent update blocked by reorder'
      );
      expect(updatePid).not.toBe(reorderPid);
      const lockEvidence = await sql<{ details: unknown }>`
        SELECT jsonb_build_object(
          'pid', locks.pid,
          'lockType', locks.locktype,
          'mode', locks.mode,
          'granted', locks.granted,
          'relation', locks.relation::regclass::text,
          'transactionId', locks.transactionid::text,
          'classId', locks.classid::text,
          'objectId', locks.objid::text,
          'blockingPids', pg_blocking_pids(locks.pid),
          'query', activity.query
        ) AS details
        FROM pg_locks AS locks
        JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
        WHERE locks.pid IN (${reorderPid}, ${updatePid})
          AND locks.locktype IN ('advisory', 'transactionid', 'tuple')
        ORDER BY locks.pid, locks.locktype, locks.granted
      `.execute(ctx.testContainer.db);

      // Candidate lock inversion: A owns row and next wants source advisory;
      // B owns that advisory and wants A's row. Releasing only the artificial gate
      // closes the real API/API cycle. Safe implementations serialize instead.
      await gate.release();
      const results = await Promise.all(requests);
      const attempts = {
        reorder: await sequenceCalls(ctx, names.reorderSequence),
        update: await sequenceCalls(ctx, names.updateSequence),
      };
      const evidence = JSON.stringify({
        results,
        attempts,
        locksBeforeRelease: lockEvidence.rows.map((row) => row.details),
      });
      expect
        .soft(
          results.map((result) => result.status),
          evidence
        )
        .toEqual([200, 200]);
      expect
        .soft(
          results.map((result) => result.body),
          evidence
        )
        .toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
      // Ordinary UoW retries can otherwise hide the newly introduced deadlock.
      expect.soft(attempts, `transaction retries are not acceptable: ${evidence}`).toEqual({
        reorder: 1,
        update: 1,
      });

      await ctx.drainOutbox();
      const parents = await ctx.listRecords(fixture.parentTableId, { viewId: fixture.viewId });
      expect(parents.map((record) => record.id)).toEqual([fixture.parent.id, fixture.anchor.id]);
      const parent = parents.find((record) => record.id === fixture.parent.id)!;
      expect(parent.fields[fixture.parentTitleId]).toBe('Updated parent');
      expect(parent.fields[fixture.linkId]).toEqual([
        expect.objectContaining({ id: fixture.childB.id }),
      ]);
      const children = await ctx.listRecords(fixture.childTableId);
      const childA = children.find((record) => record.id === fixture.childA.id)!;
      const childB = children.find((record) => record.id === fixture.childB.id)!;
      expect(childA.fields[fixture.reverseId] ?? null).toBeNull();
      expect(childB.fields[fixture.reverseId]).toEqual(
        expect.objectContaining({ id: fixture.parent.id })
      );
      const owners = await sql<{ record_id: string; owner_id: string | null }>`
        SELECT __id AS record_id, ${sql.id(fixture.ownerColumn)} AS owner_id
        FROM ${sql.table(fixture.childDbTableName)}
        WHERE __id IN (${fixture.childA.id}, ${fixture.childB.id})
      `.execute(ctx.testContainer.db);
      expect(new Map(owners.rows.map((row) => [row.record_id, row.owner_id]))).toEqual(
        new Map<string, string | null>([
          [fixture.childA.id, null],
          [fixture.childB.id, fixture.parent.id],
        ])
      );
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropInstrumentation(ctx, fixture, names);
    }
  }, 60_000);
});
