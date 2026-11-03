/* eslint-disable @typescript-eslint/naming-convention */
import { getRandomString, RecordUpdated, RecordsBatchUpdated } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';
import { executeUndo } from './undo-redo/shared/undoRedoE2eTestKit';

const WAIT_TIMEOUT_MS = 15_000;

type Mode = 'single' | 'batch';
type RecordRef = { id: string };
type LinkValue = { id: string; title: string };
type ApiResult = { status: number; body: unknown };
type HeldGate = { pid: number; release(): Promise<void> };
type GateNames = { functionName: string; triggerName: string; key: string };
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
  sources: RecordRef[];
  targetB: RecordRef;
  targetC: RecordRef;
};

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
    .executeTakeFirstOrThrow();
  if (!row.db_field_name) throw new Error(`Missing database column for ${fieldId}`);
  return row.db_field_name;
};

const createFixture = async (ctx: SharedTestContext, sourceCount: number): Promise<Fixture> => {
  const targetTitleFieldId = `fld${getRandomString(16)}`;
  const targets = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Stale event targets ${getRandomString(8)}`,
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
  const sourceTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Stale event sources ${getRandomString(8)}`,
    fields: [
      { id: markerFieldId, name: 'Marker', type: 'number' },
      {
        id: primaryFieldId,
        name: 'Name',
        type: 'formula',
        isPrimary: true,
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
  const table = await ctx.getTableById(sourceTable.id);
  const options = table.fields.find((field) => field.id === linkFieldId)?.options as
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
  const sources = await ctx.createRecords(
    sourceTable.id,
    Array.from({ length: sourceCount }, () => ({
      fields: { [markerFieldId]: 0, [linkFieldId]: [{ id: targetB.id }] },
    }))
  );
  expect(sources).toHaveLength(sourceCount);
  return {
    sourceTableId: sourceTable.id,
    targetTableId: targets.id,
    sourceDbTableName: await tableDbName(ctx, sourceTable.id),
    targetDbTableName: await tableDbName(ctx, targets.id),
    markerFieldId,
    markerColumn: await fieldDbName(ctx, markerFieldId),
    primaryFieldId,
    primaryColumn: await fieldDbName(ctx, primaryFieldId),
    linkFieldId,
    linkColumn: await fieldDbName(ctx, linkFieldId),
    reverseFieldId: options.symmetricFieldId,
    reverseColumn: await fieldDbName(ctx, options.symmetricFieldId),
    junctionTableName: options.fkHostTableName,
    sourceKeyColumn: options.selfKeyName,
    targetKeyColumn: options.foreignKeyName,
    sources,
    targetB,
    targetC,
  };
};

const postUpdate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  mode: Mode,
  requestId: string,
  fields: Record<string, unknown>
): Promise<ApiResult> => {
  const response = await fetch(
    `${ctx.baseUrl}/tables/${mode === 'single' ? 'updateRecord' : 'updateRecords'}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify(
        mode === 'single'
          ? { tableId: fixture.sourceTableId, recordId: fixture.sources[0]!.id, fields }
          : {
              tableId: fixture.sourceTableId,
              records: fixture.sources.map(({ id }) => ({ id, fields })),
            }
      ),
      signal: AbortSignal.timeout(45_000),
    }
  );
  return { status: response.status, body: await response.json().catch(() => undefined) };
};

const expectSuccess = (result: ApiResult) => {
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body).toEqual(expect.objectContaining({ ok: true }));
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
  expect(remaining.rows).toEqual([{ pending: 0, dead: 0 }]);
};

const sortLinks = (links: LinkValue[]) => [...links].sort((a, b) => a.id.localeCompare(b.id));

const expectState = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  target: LinkValue,
  marker: number
): Promise<void> => {
  const sources = await ctx.listRecordsWithoutDrain(fixture.sourceTableId);
  for (const source of fixture.sources) {
    const record = sources.find(({ id }) => id === source.id);
    expect(record).toBeDefined();
    expect(record?.fields[fixture.markerFieldId]).toBe(marker);
    expect(record?.fields[fixture.primaryFieldId]).toBe('S');
    expect(record?.fields[fixture.linkFieldId]).toEqual([target]);
  }
  const inverse = sortLinks(fixture.sources.map(({ id }) => ({ id, title: 'S' })));
  const targets = await ctx.listRecordsWithoutDrain(fixture.targetTableId);
  for (const targetRecord of [fixture.targetB, fixture.targetC]) {
    const expected = targetRecord.id === target.id ? inverse : [];
    const record = targets.find(({ id }) => id === targetRecord.id);
    expect(record).toBeDefined();
    expect(sortLinks((record?.fields[fixture.reverseFieldId] ?? []) as LinkValue[])).toEqual(
      expected
    );
  }

  // Read the physical caches and junction too; query-time projection must not
  // hide a lost link or a stale inverse after the request or its undo.
  const storedSources = await sql<{ id: string; marker: number; title: string; links: unknown }>`
    SELECT __id AS id, ${sql.id(fixture.markerColumn)} AS marker,
      ${sql.id(fixture.primaryColumn)} AS title, ${sql.id(fixture.linkColumn)} AS links
    FROM ${sql.table(fixture.sourceDbTableName)}
    WHERE __id IN (${sql.join(fixture.sources.map(({ id }) => id))})
  `.execute(ctx.testContainer.db);
  const storedSourcesById = new Map(storedSources.rows.map((row) => [row.id, row]));
  expect(storedSourcesById.size).toBe(fixture.sources.length);
  for (const { id } of fixture.sources) {
    expect(storedSourcesById.get(id)).toEqual({ id, marker, title: 'S', links: [target] });
  }
  const storedTargets = await sql<{ id: string; links: LinkValue[] | null }>`
    SELECT __id AS id, ${sql.id(fixture.reverseColumn)} AS links
    FROM ${sql.table(fixture.targetDbTableName)}
    WHERE __id IN (${fixture.targetB.id}, ${fixture.targetC.id})
  `.execute(ctx.testContainer.db);
  expect(storedTargets.rows).toHaveLength(2);
  for (const row of storedTargets.rows) {
    expect(sortLinks(row.links ?? [])).toEqual(row.id === target.id ? inverse : []);
  }
  const junction = await sql<{ source_id: string; target_id: string }>`
    SELECT ${sql.id(fixture.sourceKeyColumn)} AS source_id,
      ${sql.id(fixture.targetKeyColumn)} AS target_id
    FROM ${sql.table(fixture.junctionTableName)}
    WHERE ${sql.id(fixture.sourceKeyColumn)} IN (${sql.join(fixture.sources.map(({ id }) => id))})
  `.execute(ctx.testContainer.db);
  const junctionBySourceId = new Map(junction.rows.map((row) => [row.source_id, row.target_id]));
  expect(junctionBySourceId.size).toBe(fixture.sources.length);
  for (const { id } of fixture.sources) {
    expect(junctionBySourceId.get(id)).toBe(target.id);
  }
};

// This is the statement-trigger barrier used by
// link-many-many-new-seed-concurrency: pre-read B has finished, but no source
// tuple is locked. Only T1 writes Marker, so T2 can commit C before T1 resumes.
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
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    BEFORE UPDATE OF ${sql.id(fixture.markerColumn)}
    ON ${sql.table(fixture.sourceDbTableName)}
    FOR EACH STATEMENT
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

const waitForBlockedBackend = async (ctx: SharedTestContext, blockerPid: number): Promise<void> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await sql<{ pid: number }>`
      SELECT pid::int AS pid FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return;
    expect(result.rows, 'only T1 may wait on this unique advisory gate').toHaveLength(0);
  }
  throw new Error('PostgreSQL did not observe T1 blocked after its stale pre-read');
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

const expectAuthoritativeEvent = (
  ctx: SharedTestContext,
  fixture: Fixture,
  mode: Mode,
  eventOffset: number
) => {
  const events = ctx.testContainer.eventBus
    .events()
    .slice(eventOffset)
    .filter(
      (event): event is RecordUpdated | RecordsBatchUpdated =>
        (mode === 'single'
          ? event instanceof RecordUpdated
          : event instanceof RecordsBatchUpdated) &&
        event.tableId.toString() === fixture.sourceTableId &&
        event.source === 'user'
    );
  expect(events, 'T1 must publish exactly one real user mutation event').toHaveLength(1);
  const event = events[0]!;
  if (mode === 'single') {
    expect(event).toBeInstanceOf(RecordUpdated);
    if (!(event instanceof RecordUpdated)) throw new Error('Missing RecordUpdated');
    expect(event.recordId.toString()).toBe(fixture.sources[0]!.id);
    expect(event.changes.filter(({ fieldId }) => fieldId === fixture.linkFieldId)).toEqual([
      {
        fieldId: fixture.linkFieldId,
        oldValue: [{ id: fixture.targetC.id, title: 'C' }],
        newValue: [{ id: fixture.targetB.id, title: 'B' }],
      },
    ]);
  } else {
    expect(event).toBeInstanceOf(RecordsBatchUpdated);
    if (!(event instanceof RecordsBatchUpdated)) throw new Error('Missing RecordsBatchUpdated');
    expect(event.updates.map(({ recordId }) => recordId).sort()).toEqual(
      fixture.sources.map(({ id }) => id).sort()
    );
    for (const update of event.updates) {
      expect(update.changes.filter(({ fieldId }) => fieldId === fixture.linkFieldId)).toEqual([
        {
          fieldId: fixture.linkFieldId,
          oldValue: [{ id: fixture.targetC.id, title: 'C' }],
          newValue: [{ id: fixture.targetB.id, title: 'B' }],
        },
      ]);
    }
  }
};

describe('manyMany authoritative update events and undo (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it.each(['single', 'batch'] as const)(
    '%s publishes old C/new B after a stale B pre-read and undo restores C',
    async (mode) => {
      // Two rows force the explicit-batch route rather than its single-row shortcut.
      const fixture = await createFixture(ctx, mode === 'single' ? 1 : 2);
      const prefix = `t8242_event_${getRandomString(8).toLowerCase()}`;
      const names: GateNames = {
        functionName: `${prefix}_fn`,
        triggerName: `${prefix}_trg`,
        key: `${prefix}:before-source-update`,
      };
      const t1RequestId = `${prefix}:t1`;
      const requests: Promise<ApiResult>[] = [];
      let gate: HeldGate | undefined;
      const targetB: LinkValue = { id: fixture.targetB.id, title: 'B' };
      const targetC: LinkValue = { id: fixture.targetC.id, title: 'C' };

      try {
        await drainComputed(ctx, fixture);
        await expectState(ctx, fixture, targetB, 0);
        await installGate(ctx, fixture, names);
        gate = await holdGate(ctx, names.key);

        const t1 = postUpdate(ctx, fixture, mode, t1RequestId, {
          [fixture.markerFieldId]: 1,
          [fixture.linkFieldId]: [{ id: fixture.targetB.id }],
        });
        requests.push(t1);
        void Promise.allSettled(requests);
        await waitForBlockedBackend(ctx, gate.pid);

        const t2 = postUpdate(ctx, fixture, mode, `${prefix}:t2`, {
          [fixture.linkFieldId]: [{ id: fixture.targetC.id }],
        });
        requests.push(t2);
        void Promise.allSettled(requests);
        expectSuccess(await t2);
        await drainComputed(ctx, fixture);
        // Independent HTTP and SQL reads prove C committed while T1's B plan
        // remains parked; elapsed time never determines this ordering.
        await expectState(ctx, fixture, targetC, 0);
        // DomainWriteTransaction records committed events directly, without the
        // request-context enrichment performed by MemoryEventBus.publish. Use
        // the observed T2 commit as the event boundary instead of requestId.
        const t1EventOffset = ctx.testContainer.eventBus.events().length;

        await gate.release();
        expectSuccess(await t1);
        await drainComputed(ctx, fixture);
        await expectState(ctx, fixture, targetB, 1);
        expectAuthoritativeEvent(ctx, fixture, mode, t1EventOffset);

        // The real undo stack must restore the committed OLD=C snapshot, not
        // the B that T1 read before it waited. This executes the production
        // UndoCommand; it does not synthesize an inverse from our expectation.
        await executeUndo(ctx, fixture.sourceTableId);
        await drainComputed(ctx, fixture);
        await expectState(ctx, fixture, targetC, 0);
      } finally {
        await gate?.release();
        await Promise.allSettled(requests);
        await dropGate(ctx, fixture, names);
      }
    },
    60_000
  );
});
