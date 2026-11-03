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
  markerFieldId: string;
  markerColumn: string;
  linkFieldId: string;
  reverseFieldId: string;
  junctionTableName: string;
  sourceKeyColumn: string;
  targetKeyColumn: string;
  source: RecordRef;
  targetX: RecordRef;
  targetY: RecordRef;
  targetZ: RecordRef;
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
    name: `Many-many stale targets ${getRandomString(8)}`,
    fields: [{ id: targetTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const [targetX, targetY, targetZ] = await ctx.createRecords(targets.id, [
    { fields: { [targetTitleFieldId]: 'X' } },
    { fields: { [targetTitleFieldId]: 'Y' } },
    { fields: { [targetTitleFieldId]: 'Z' } },
  ]);
  if (!targetX || !targetY || !targetZ) throw new Error('Missing X/Y/Z target records');

  const sourceTitleFieldId = `fld${getRandomString(16)}`;
  const markerFieldId = `fld${getRandomString(16)}`;
  const linkFieldId = `fld${getRandomString(16)}`;
  const sources = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Many-many stale sources ${getRandomString(8)}`,
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
  const markerMeta = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('id', '=', markerFieldId)
    .executeTakeFirstOrThrow();
  if (!markerMeta.db_field_name) throw new Error('Missing marker database column');

  const sourceTable = await ctx.getTableById(sources.id);
  const linkField = sourceTable.fields.find((field) => field.id === linkFieldId);
  if (!linkField) throw new Error('Missing source link field');
  const options = linkField.options as LinkOptions | undefined;
  if (
    !options?.fkHostTableName ||
    !options.selfKeyName ||
    !options.foreignKeyName ||
    !options.symmetricFieldId
  ) {
    throw new Error('Many-many link storage metadata is incomplete');
  }

  const source = await ctx.createRecord(sources.id, {
    [sourceTitleFieldId]: 'S',
    [markerFieldId]: 'initial',
    [linkFieldId]: [{ id: targetX.id }],
  });
  await ctx.drainOutbox();

  return {
    sourceTableId: sources.id,
    targetTableId: targets.id,
    sourceDbTableName: sourceMeta.db_table_name,
    markerFieldId,
    markerColumn: markerMeta.db_field_name,
    linkFieldId,
    reverseFieldId: options.symmetricFieldId,
    junctionTableName: options.fkHostTableName,
    sourceKeyColumn: options.selfKeyName,
    targetKeyColumn: options.foreignKeyName,
    source,
    targetX,
    targetY,
    targetZ,
  };
};

const instrumentationNames = (): Instrumentation => {
  const prefix = `t8242_m2m_stale_${getRandomString(8).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    triggerName: `${prefix}_trg`,
    gateKey: `${prefix}:before-source-update`,
  };
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
      PERFORM pg_advisory_xact_lock(
        ('x' || substr(md5(TG_ARGV[0]), 1, 16))::bit(64)::bigint
      );
      RETURN NULL;
    END;
    $$
  `.execute(ctx.testContainer.db);
  // The update builder has already read the old X edge before it executes the
  // source UPDATE. A statement trigger gates T1 at that boundary without taking
  // a source-row or junction-row lock, so T2 can replace X with Y and commit.
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    BEFORE UPDATE OF ${sql.id(fixture.markerColumn)}
    ON ${sql.table(fixture.sourceDbTableName)}
    FOR EACH STATEMENT
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(${sql.lit(names.gateKey)})
  `.execute(ctx.testContainer.db);
};

const dropGate = async (
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

const waitForBlockedBackend = async (
  ctx: SharedTestContext,
  blockerPid: number
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
    expect(result.rows, 'only T1 should wait on its unique advisory gate').toHaveLength(0);
    // Poll PostgreSQL's lock state; elapsed time is never used as ordering evidence.
    await delay(20);
  }
  throw new Error('PostgreSQL did not observe T1 blocked at the pre-write gate');
};

const readSourceJunctionRows = async (ctx: SharedTestContext, fixture: Fixture) => {
  const result = await sql<{ source_id: string; target_id: string }>`
    SELECT
      ${sql.id(fixture.sourceKeyColumn)} AS source_id,
      ${sql.id(fixture.targetKeyColumn)} AS target_id
    FROM ${sql.table(fixture.junctionTableName)}
    WHERE ${sql.id(fixture.sourceKeyColumn)} = ${fixture.source.id}
    ORDER BY ${sql.id(fixture.targetKeyColumn)}
  `.execute(ctx.testContainer.db);
  return result.rows;
};

describe('manyMany stale pre-read reconciliation (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('replaces a link from the latest committed junction state after a concurrent stale pre-read', async () => {
    const fixture = await createFixture(ctx);
    const names = instrumentationNames();
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      const initialSource = findRecord(
        await ctx.listRecords(fixture.sourceTableId),
        fixture.source
      );
      expect(linkIds(initialSource.fields[fixture.linkFieldId])).toEqual([fixture.targetX.id]);
      const initialTargets = await ctx.listRecords(fixture.targetTableId);
      expect(
        linkIds(findRecord(initialTargets, fixture.targetX).fields[fixture.reverseFieldId])
      ).toEqual([fixture.source.id]);
      expect(
        linkIds(findRecord(initialTargets, fixture.targetY).fields[fixture.reverseFieldId])
      ).toEqual([]);
      expect(
        linkIds(findRecord(initialTargets, fixture.targetZ).fields[fixture.reverseFieldId])
      ).toEqual([]);
      expect(await readSourceJunctionRows(ctx, fixture)).toEqual([
        { source_id: fixture.source.id, target_id: fixture.targetX.id },
      ]);

      await installGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.gateKey);

      const t1 = postUpdate(ctx, fixture.sourceTableId, fixture.source.id, {
        [fixture.markerFieldId]: 'written by T1',
        [fixture.linkFieldId]: [{ id: fixture.targetZ.id }],
      });
      requests.push(t1);
      void Promise.allSettled(requests);
      await waitForBlockedBackend(ctx, gate.pid);

      const t2 = postUpdate(ctx, fixture.sourceTableId, fixture.source.id, {
        [fixture.linkFieldId]: [{ id: fixture.targetY.id }],
      });
      requests.push(t2);
      void Promise.allSettled(requests);
      const t2Result = await t2;
      expect(t2Result.status, JSON.stringify(t2Result.body)).toBe(200);
      expect(t2Result.body).toEqual(expect.objectContaining({ ok: true }));

      // Visibility on a separate pool checkout proves T2 committed before T1 resumes.
      expect(await readSourceJunctionRows(ctx, fixture)).toEqual([
        { source_id: fixture.source.id, target_id: fixture.targetY.id },
      ]);

      await gate.release();
      const t1Result = await t1;
      expect(t1Result.status, JSON.stringify(t1Result.body)).toBe(200);
      expect(t1Result.body).toEqual(expect.objectContaining({ ok: true }));

      await ctx.drainOutbox();
      const source = findRecord(await ctx.listRecords(fixture.sourceTableId), fixture.source);
      expect(source.fields[fixture.markerFieldId]).toBe('written by T1');
      expect(linkIds(source.fields[fixture.linkFieldId])).toEqual([fixture.targetZ.id]);

      const targets = await ctx.listRecords(fixture.targetTableId);
      expect(linkIds(findRecord(targets, fixture.targetX).fields[fixture.reverseFieldId])).toEqual(
        []
      );
      expect(linkIds(findRecord(targets, fixture.targetY).fields[fixture.reverseFieldId])).toEqual(
        []
      );
      expect(linkIds(findRecord(targets, fixture.targetZ).fields[fixture.reverseFieldId])).toEqual([
        fixture.source.id,
      ]);

      expect(await readSourceJunctionRows(ctx, fixture)).toEqual([
        { source_id: fixture.source.id, target_id: fixture.targetZ.id },
      ]);
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropGate(ctx, fixture, names);
    }
  }, 60_000);
});
