/* eslint-disable @typescript-eslint/naming-convention */
import { getRandomString, RecordUpdated } from '@teable/v2-core';
import { updateRecordOkResponseSchema } from '@teable/v2-contract-http';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const WAIT_TIMEOUT_MS = 15_000;

type RecordRef = { id: string };
type ApiResult = { status: number; body: unknown };
type HeldGate = { pid: number; release(): Promise<void> };
type LinkValue = { id: string; title: string };

type Fixture = {
  sourceTableId: string;
  sourceDbTableName: string;
  linkFieldId: string;
  linkColumn: string;
  foreignKeyColumn: string;
  source: RecordRef;
  targetX: RecordRef;
  targetY: RecordRef;
};

type Instrumentation = {
  functionName: string;
  sequenceName: string;
  triggerName: string;
  gateKey: string;
};

type StoredLinkRow = {
  link_value: unknown;
  foreign_id: string | null;
};

const advisoryKey = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

const createFixture = async (ctx: SharedTestContext): Promise<Fixture> => {
  const targetTitleFieldId = `fld${getRandomString(16)}`;
  const targets = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Typecast title targets ${getRandomString(8)}`,
    fields: [{ id: targetTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const [targetX, targetY] = await ctx.createRecords(targets.id, [
    { fields: { [targetTitleFieldId]: 'X' } },
    { fields: { [targetTitleFieldId]: 'Y' } },
  ]);
  if (!targetX || !targetY) throw new Error('Missing X/Y target records');

  const sourceTitleFieldId = `fld${getRandomString(16)}`;
  const linkFieldId = `fld${getRandomString(16)}`;
  const sources = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Typecast title sources ${getRandomString(8)}`,
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
  const linkMeta = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('id', '=', linkFieldId)
    .executeTakeFirstOrThrow();
  if (!linkMeta.db_field_name) throw new Error('Missing link database column');

  const source = await ctx.createRecord(sources.id, {
    [sourceTitleFieldId]: 'S',
    [linkFieldId]: { id: targetX.id, title: 'X' },
  });

  return {
    sourceTableId: sources.id,
    sourceDbTableName: sourceMeta.db_table_name,
    linkFieldId,
    linkColumn: linkMeta.db_field_name,
    foreignKeyColumn: `__fk_${linkFieldId}`,
    source,
    targetX,
    targetY,
  };
};

const instrumentationNames = (): Instrumentation => {
  const prefix = `t8242_typecast_title_${getRandomString(8).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    sequenceName: `${prefix}_seq`,
    triggerName: `${prefix}_trg`,
    gateKey: `${prefix}:before-link-update`,
  };
};

const installGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: Instrumentation
): Promise<void> => {
  await sql`CREATE SEQUENCE ${sql.id('public', names.sequenceName)}`.execute(ctx.testContainer.db);
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF nextval(TG_ARGV[0]::regclass) = 1 THEN
        PERFORM pg_advisory_xact_lock(
          ('x' || substr(md5(TG_ARGV[1]), 1, 16))::bit(64)::bigint
        );
      END IF;
      RETURN NULL;
    END;
    $$
  `.execute(ctx.testContainer.db);
  // T1's UPDATE snapshot exists when this trigger runs, so its X=X write is a
  // no-op that may linearize before T2. After T2 commits Y, T1's separate
  // transaction-authoritative no-op read must observe that latest stored row.
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    BEFORE UPDATE OF ${sql.id(fixture.linkColumn)}
    ON ${sql.table(fixture.sourceDbTableName)}
    FOR EACH STATEMENT
    EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.sequenceName}`)},
      ${sql.lit(names.gateKey)}
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
    ON ${sql.table(fixture.sourceDbTableName)}
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
    // The next database round trip yields; ordering evidence comes only from
    // PostgreSQL's lock graph, never from an elapsed-time sleep.
  }
  throw new Error('PostgreSQL did not observe T1 blocked at the statement-trigger gate');
};

const postTypecastUpdate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  requestId: string,
  target: RecordRef
): Promise<ApiResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
    },
    body: JSON.stringify({
      tableId: fixture.sourceTableId,
      recordId: fixture.source.id,
      typecast: true,
      fields: { [fixture.linkFieldId]: { id: target.id } },
    }),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
};

const requireSuccessfulUpdate = (result: ApiResult) => {
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const parsed = updateRecordOkResponseSchema.safeParse(result.body);
  expect(parsed.success, JSON.stringify(result.body)).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Update failed: ${JSON.stringify(result.body)}`);
  }
  return parsed.data.data;
};

const readStoredLink = async (ctx: SharedTestContext, fixture: Fixture): Promise<StoredLinkRow> => {
  const result = await sql<StoredLinkRow>`
    SELECT
      ${sql.id(fixture.linkColumn)} AS link_value,
      ${sql.id(fixture.foreignKeyColumn)} AS foreign_id
    FROM ${sql.table(fixture.sourceDbTableName)}
    WHERE __id = ${fixture.source.id}
  `.execute(ctx.testContainer.db);
  const row = result.rows[0];
  if (!row) throw new Error(`Missing source record ${fixture.source.id}`);
  return row;
};

const findSource = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  source: RecordRef
) => {
  const record = records.find(({ id }) => id === source.id);
  if (!record) throw new Error(`Missing source record ${source.id}`);
  return record;
};

describe('typecast id-only authoritative no-op concurrency (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('returns the authoritative Y title after a snapshot no-op and leaves Y stored', async () => {
    const fixture = await createFixture(ctx);
    const names = instrumentationNames();
    const expectedX: LinkValue = { id: fixture.targetX.id, title: 'X' };
    const expectedY: LinkValue = { id: fixture.targetY.id, title: 'Y' };
    const t1RequestId = `t8242-title-t1-${getRandomString(12)}`;
    const t2RequestId = `t8242-title-t2-${getRandomString(12)}`;
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await ctx.drainOutbox();
      expect(await readStoredLink(ctx, fixture)).toEqual({
        link_value: expectedX,
        foreign_id: fixture.targetX.id,
      });
      const eventOffset = ctx.testContainer.eventBus.events().length;

      await installGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.gateKey);

      const t1 = postTypecastUpdate(ctx, fixture, t1RequestId, fixture.targetX);
      requests.push(t1);
      void Promise.allSettled(requests);
      await waitForBlockedBackend(ctx, gate.pid);

      const t2 = postTypecastUpdate(ctx, fixture, t2RequestId, fixture.targetY);
      requests.push(t2);
      void Promise.allSettled(requests);
      const t2Data = requireSuccessfulUpdate(await t2);
      expect(t2Data.record.fields[fixture.linkFieldId]).toEqual(expectedY);

      // A separate pool checkout observes Y, proving T2 committed before T1 resumes.
      expect(await readStoredLink(ctx, fixture)).toEqual({
        link_value: expectedY,
        foreign_id: fixture.targetY.id,
      });

      await gate.release();
      const t1Data = requireSuccessfulUpdate(await t1);
      // The main UPDATE is an X=X snapshot no-op. The authoritative read in
      // T1's transaction must return the Y that T2 committed, including its
      // title, without overwriting Y or claiming that T1 updated the record.
      expect(t1Data.record.fields[fixture.linkFieldId]).toEqual(expectedY);
      expect(t1Data.events.map(({ name }) => name)).not.toContain('RecordUpdated');

      expect(await readStoredLink(ctx, fixture)).toEqual({
        link_value: expectedY,
        foreign_id: fixture.targetY.id,
      });

      await ctx.drainOutbox();
      const persisted = findSource(
        await ctx.listRecordsWithoutDrain(fixture.sourceTableId),
        fixture.source
      );
      expect(persisted.fields[fixture.linkFieldId]).toEqual(expectedY);

      const t1Events = ctx.testContainer.eventBus
        .events()
        .slice(eventOffset)
        .filter(
          (event): event is RecordUpdated =>
            event instanceof RecordUpdated &&
            event.requestId === t1RequestId &&
            event.tableId.toString() === fixture.sourceTableId &&
            event.recordId.toString() === fixture.source.id
        );
      expect(t1Events).toHaveLength(0);
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropGate(ctx, fixture, names);
    }
  }, 60_000);
});
