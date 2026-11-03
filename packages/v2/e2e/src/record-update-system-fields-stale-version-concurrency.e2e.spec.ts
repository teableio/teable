/* eslint-disable @typescript-eslint/naming-convention */
import { updateRecordOkResponseSchema } from '@teable/v2-contract-http';
import {
  ActorId,
  buildUserAvatarUrl,
  getRandomString,
  RecordUpdated,
  UpdateRecordCommand,
  v2CoreTokens,
  type ICommandBus,
  type UpdateRecordResult,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const WAIT_TIMEOUT_MS = 15_000;
const FORGED_TIME = '1900-01-01T00:00:00.000Z';
const FORGED_USER = { id: 'usrForgedAuditActor', title: 'Forged actor' };

type ApiResult = { status: number; body: unknown };
type HeldGate = { pid: number; release(): Promise<void> };
type GateNames = { functionName: string; sequenceName: string; triggerName: string; key: string };
type Fixture = {
  tableId: string;
  recordId: string;
  dbTableName: string;
  titleFieldId: string;
  titleColumn: string;
  lmtFieldId: string;
  lmtColumn: string;
  lmbFieldId: string;
  lmbColumn: string;
};
type StoredRow = {
  title: string;
  version: number;
  lmt: Date | string;
  lmb: Record<string, unknown>;
  systemTime: Date | string;
  systemActor: string;
};

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const advisoryKey = (key: string) => sql`('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint`;

const createFixture = async (ctx: SharedTestContext): Promise<Fixture> => {
  const titleFieldId = `fld${getRandomString(16)}`;
  const lmtFieldId = `fld${getRandomString(16)}`;
  const lmbFieldId = `fld${getRandomString(16)}`;
  const table = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Stale version audit fields ${getRandomString(8)}`,
    fields: [
      { id: titleFieldId, name: 'Title', type: 'singleLineText', isPrimary: true },
      { id: lmtFieldId, name: 'LMT', type: 'lastModifiedTime' },
      { id: lmbFieldId, name: 'LMB', type: 'lastModifiedBy' },
    ],
    views: [{ type: 'grid' }],
  });
  const record = await ctx.createRecord(table.id, { [titleFieldId]: 'initial' });
  const tableMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', table.id)
    .executeTakeFirstOrThrow();
  const columns = await ctx.testContainer.db
    .selectFrom('field')
    .select(['id', 'db_field_name'])
    .where('id', 'in', [titleFieldId, lmtFieldId, lmbFieldId])
    .execute();
  const column = (id: string): string => {
    const name = columns.find((field) => field.id === id)?.db_field_name;
    if (!name) throw new Error(`Missing database column for ${id}`);
    return name;
  };
  return {
    tableId: table.id,
    recordId: record.id,
    dbTableName: tableMeta.db_table_name,
    titleFieldId,
    titleColumn: column(titleFieldId),
    lmtFieldId,
    lmtColumn: column(lmtFieldId),
    lmbFieldId,
    lmbColumn: column(lmbFieldId),
  };
};

const readStoredRow = async (ctx: SharedTestContext, fixture: Fixture): Promise<StoredRow> => {
  const result = await sql<StoredRow>`
    SELECT ${sql.id(fixture.titleColumn)} AS title, __version AS version,
      ${sql.id(fixture.lmtColumn)} AS lmt, ${sql.id(fixture.lmbColumn)} AS lmb,
      __last_modified_time AS "systemTime", __last_modified_by AS "systemActor"
    FROM ${sql.table(fixture.dbTableName)} WHERE __id = ${fixture.recordId}
  `.execute(ctx.testContainer.db);
  const row = result.rows[0];
  if (!row) throw new Error(`Missing record ${fixture.recordId}`);
  return row;
};

const installGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: GateNames
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
  // Only T1 waits: a sequence is not transactional, so T2's statement passes
  // the same trigger while T1 is parked before acquiring the record tuple lock.
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    BEFORE UPDATE OF ${sql.id(fixture.titleColumn)} ON ${sql.table(fixture.dbTableName)}
    FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.sequenceName}`)}, ${sql.lit(names.key)}
    )
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
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND state = 'active' AND wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return;
    expect(result.rows, 'only T1 may wait on this unique advisory gate').toHaveLength(0);
    // Database lock-graph evidence, not a sleep, establishes the stale pre-read.
  }
  throw new Error('PostgreSQL did not observe T1 blocked after its version pre-read');
};

const dropGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: GateNames
): Promise<void> => {
  await sql`
    DROP TRIGGER IF EXISTS ${sql.id(names.triggerName)} ON ${sql.table(fixture.dbTableName)}
  `.execute(ctx.testContainer.db);
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
  await sql`DROP SEQUENCE IF EXISTS ${sql.id('public', names.sequenceName)}`.execute(
    ctx.testContainer.db
  );
};

const postMixedUpdate = async (ctx: SharedTestContext, fixture: Fixture): Promise<ApiResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tableId: fixture.tableId,
      recordId: fixture.recordId,
      fields: {
        [fixture.titleFieldId]: 'T1',
        [fixture.lmtFieldId]: FORGED_TIME,
        [fixture.lmbFieldId]: FORGED_USER,
      },
    }),
  });
  return { status: response.status, body: await response.json() };
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

describe('mixed ordinary/system-field stale-version update (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('ignores forged LMT/LMB without rejecting a real update after T2 advances its pre-read version', async () => {
    const fixture = await createFixture(ctx);
    const prefix = `t8242_mixed_audit_${getRandomString(8).toLowerCase()}`;
    const names: GateNames = {
      functionName: `${prefix}_fn`,
      sequenceName: `${prefix}_seq`,
      triggerName: `${prefix}_trg`,
      key: `${prefix}:before-update`,
    };
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await ctx.drainOutbox();
      const initial = await readStoredRow(ctx, fixture);
      expect(initial.title).toBe('initial');
      await installGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.key);

      // The actual API payload includes BOTH forged computed audit fields and
      // a writable field. T1 must not receive a stale-version conflict merely
      // because those ignored fields were present in its request.
      const t1 = postMixedUpdate(ctx, fixture);
      requests.push(t1);
      void Promise.allSettled(requests);
      await waitForBlockedBackend(ctx, gate.pid);

      // Use the real command/transaction/repository pipeline with another actor
      // so T2 changes LMB as well as the ordinary value, LMT, and __version.
      const commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const t2 = await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
        { actorId: ActorId.create('system')._unsafeUnwrap() },
        UpdateRecordCommand.create({
          tableId: fixture.tableId,
          recordId: fixture.recordId,
          fields: { [fixture.titleFieldId]: 'T2' },
        })._unsafeUnwrap()
      );
      expect(t2.isOk(), t2.isErr() ? t2.error.message : undefined).toBe(true);
      t2._unsafeUnwrap();
      // An independent pool checkout proves T2 committed while T1 is blocked.
      const committed = await readStoredRow(ctx, fixture);
      expect(committed.title).toBe('T2');
      expect(committed.version).toBe(initial.version + 1);
      expect(committed.systemActor).toBe('system');
      expect(committed.lmb).toMatchObject({ id: 'system' });
      expect(committed.lmb).not.toEqual(initial.lmb);
      expect(iso(committed.lmt)).toBe(iso(committed.systemTime));
      const eventOffset = ctx.testContainer.eventBus.events().length;

      await gate.release();
      const response = requireSuccessfulUpdate(await t1);
      await ctx.drainOutbox();
      const stored = await readStoredRow(ctx, fixture);
      expect(stored.title).toBe('T1');
      expect(stored.version).toBe(committed.version + 1);
      expect(stored.systemActor).toBe(ctx.testUser.id);
      expect(stored.lmb).toMatchObject({ id: ctx.testUser.id });
      expect(stored.lmb.id).not.toBe(FORGED_USER.id);
      expect(iso(stored.lmt)).toBe(iso(stored.systemTime));
      expect(iso(stored.lmt)).not.toBe(FORGED_TIME);
      expect(response.record.fields[fixture.titleFieldId]).toBe('T1');
      expect(iso(response.record.fields[fixture.lmtFieldId])).toBe(iso(stored.lmt));
      expect(response.record.fields[fixture.lmbFieldId]).toMatchObject(stored.lmb);

      const events = ctx.testContainer.eventBus
        .events()
        .slice(eventOffset)
        .filter(
          (event): event is RecordUpdated =>
            event instanceof RecordUpdated &&
            event.tableId.toString() === fixture.tableId &&
            event.recordId.toString() === fixture.recordId &&
            event.source === 'user'
        );
      expect(events, 'exactly one committed T1 mutation event').toHaveLength(1);
      const event = events[0]!;
      expect(event.oldVersion).toBe(committed.version);
      expect(event.newVersion).toBe(stored.version);
      expect(event.changes.map(({ fieldId }) => fieldId).sort()).toEqual(
        [fixture.titleFieldId, fixture.lmtFieldId, fixture.lmbFieldId].sort()
      );
      expect(event.changes.find(({ fieldId }) => fieldId === fixture.titleFieldId)).toEqual({
        fieldId: fixture.titleFieldId,
        oldValue: 'T2',
        newValue: 'T1',
      });
      const lmtChange = event.changes.find(({ fieldId }) => fieldId === fixture.lmtFieldId)!;
      expect(iso(lmtChange.oldValue)).toBe(iso(committed.lmt));
      expect(iso(lmtChange.newValue)).toBe(iso(stored.lmt));
      expect(event.changes.find(({ fieldId }) => fieldId === fixture.lmbFieldId)).toEqual({
        fieldId: fixture.lmbFieldId,
        oldValue: committed.lmb,
        newValue: { ...stored.lmb, avatarUrl: buildUserAvatarUrl(ctx.testUser.id) },
      });
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropGate(ctx, fixture, names);
    }
  }, 60_000);
});
