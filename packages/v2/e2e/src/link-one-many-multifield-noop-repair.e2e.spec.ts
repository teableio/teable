/* eslint-disable @typescript-eslint/naming-convention */
import { setTimeout as delay } from 'node:timers/promises';
import { updateRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { getRandomString, isRecordsBatchUpdatedEvent, isRecordUpdatedEvent } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const WAIT_TIMEOUT_MS = 15_000;

type RecordRef = { id: string };
type ApiResult = { status: number; body: unknown };
type HeldGate = {
  pid: number;
  automaticallyReleased: boolean;
  release(): Promise<void>;
};
type Fixture = {
  parentTableId: string;
  childTableId: string;
  parentDbTableName: string;
  childDbTableName: string;
  childRelationOid: number;
  parentRelationOid: number;
  parentLinkAFieldId: string;
  parentTitleFieldId: string;
  parentLinkBFieldId: string;
  childInverseAFieldId: string;
  childInverseBFieldId: string;
  parentLinkAColumn: string;
  parentLinkBColumn: string;
  childInverseAColumn: string;
  childInverseBColumn: string;
  ownerAColumn: string;
  ownerBColumn: string;
  parentP: RecordRef;
  parentQ: RecordRef;
  childX: RecordRef;
};
type TransactionAudit = {
  tableName: string;
  functionName: string;
  triggerName: string;
};
type GenerationGate = {
  functionName: string;
  sequenceName: string;
  triggerName: string;
  gateKey: string;
};
type LocalWriteGate = {
  functionName: string;
  sequenceName: string;
  triggerName: string;
  gateKey: string;
};
type ChildState = {
  xmin: string;
  ctid: string;
  owner_a: string | null;
  owner_b: string | null;
  inverse_a: unknown;
  inverse_b: unknown;
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
    name: `Two-field no-op children ${getRandomString(8)}`,
    fields: [{ id: childTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const childDbTableName = await tableDbName(ctx, childTable.id);

  const parentTitleFieldId = `fld${getRandomString(16)}`;
  const parentTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Two-field no-op parents ${getRandomString(8)}`,
    fields: [{ id: parentTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const parentDbTableName = await tableDbName(ctx, parentTable.id);

  const parentLinkAFieldId = `fld${getRandomString(16)}`;
  const parentLinkBFieldId = `fld${getRandomString(16)}`;
  const childInverseAFieldId = `fld${getRandomString(16)}`;
  const childInverseBFieldId = `fld${getRandomString(16)}`;
  const ownerAColumn = `__fk_${childInverseAFieldId}`;
  const ownerBColumn = `__fk_${childInverseBFieldId}`;

  for (const [fieldId, inverseFieldId, name, ownerColumn] of [
    [parentLinkAFieldId, childInverseAFieldId, 'Children A', ownerAColumn],
    [parentLinkBFieldId, childInverseBFieldId, 'Children B', ownerBColumn],
  ] as const) {
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: parentTable.id,
      field: {
        id: fieldId,
        name,
        type: 'link',
        options: {
          relationship: 'oneMany',
          foreignTableId: childTable.id,
          lookupFieldId: childTitleFieldId,
          isOneWay: false,
          symmetricFieldId: inverseFieldId,
          fkHostTableName: childDbTableName,
          selfKeyName: ownerColumn,
          foreignKeyName: '__id',
        },
      },
    });
  }

  const [parentP, parentQ] = await ctx.createRecords(parentTable.id, [
    { fields: { [parentTitleFieldId]: 'P' } },
    { fields: { [parentTitleFieldId]: 'Q' } },
  ]);
  const childX = await ctx.createRecord(childTable.id, { [childTitleFieldId]: 'X' });
  if (!parentP || !parentQ) throw new Error('Missing P/Q parent records');

  await ctx.updateRecord(parentTable.id, parentP.id, {
    [parentLinkAFieldId]: [{ id: childX.id, title: 'X' }],
    [parentLinkBFieldId]: [{ id: childX.id, title: 'X' }],
  });
  await ctx.drainOutbox();

  const parentLinkAColumn = await fieldDbName(ctx, parentTable.id, parentLinkAFieldId);
  const parentLinkBColumn = await fieldDbName(ctx, parentTable.id, parentLinkBFieldId);
  const childInverseAColumn = await fieldDbName(ctx, childTable.id, childInverseAFieldId);
  const childInverseBColumn = await fieldDbName(ctx, childTable.id, childInverseBFieldId);

  // Reproduce the damaged source snapshots independently for both relationships.
  // The physical owner FKs and the two inverse caches on X deliberately remain P.
  await sql`
    UPDATE ${sql.table(parentDbTableName)}
    SET ${sql.ref(parentLinkAColumn)} = '[]'::jsonb,
        ${sql.ref(parentLinkBColumn)} = '[]'::jsonb
    WHERE ${sql.ref('__id')} = ${parentP.id}
  `.execute(ctx.testContainer.db);

  const relations = await sql<{ child_relation_oid: number; parent_relation_oid: number }>`
    SELECT
      (SELECT tableoid::int
       FROM ${sql.table(childDbTableName)}
       WHERE ${sql.ref('__id')} = ${childX.id}) AS child_relation_oid,
      (SELECT tableoid::int
       FROM ${sql.table(parentDbTableName)}
       WHERE ${sql.ref('__id')} = ${parentP.id}) AS parent_relation_oid
  `.execute(ctx.testContainer.db);
  const childRelationOid = relations.rows[0]?.child_relation_oid;
  const parentRelationOid = relations.rows[0]?.parent_relation_oid;
  if (childRelationOid === undefined || parentRelationOid === undefined) {
    throw new Error('Missing parent/child relation OID');
  }

  return {
    parentTableId: parentTable.id,
    childTableId: childTable.id,
    parentDbTableName,
    childDbTableName,
    childRelationOid,
    parentRelationOid,
    parentLinkAFieldId,
    parentTitleFieldId,
    parentLinkBFieldId,
    childInverseAFieldId,
    childInverseBFieldId,
    parentLinkAColumn,
    parentLinkBColumn,
    childInverseAColumn,
    childInverseBColumn,
    ownerAColumn,
    ownerBColumn,
    parentP,
    parentQ,
    childX,
  };
};

const postTwoEmptyLinks = async (ctx: SharedTestContext, fixture: Fixture): Promise<ApiResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateRecords`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tableId: fixture.parentTableId,
      records: [
        {
          id: fixture.parentP.id,
          fields: {
            [fixture.parentLinkAFieldId]: [],
            [fixture.parentLinkBFieldId]: [],
          },
        },
      ],
    }),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
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
  return { status: response.status, body: await response.json().catch(() => undefined) };
};

const createParentRecordsInChunks = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  count: number
): Promise<RecordRef[]> => {
  const created: RecordRef[] = [];
  for (let offset = 0; offset < count; offset += 250) {
    const batchSize = Math.min(250, count - offset);
    created.push(
      ...(await ctx.createRecords(
        fixture.parentTableId,
        Array.from({ length: batchSize }, (_, index) => ({
          fields: { [fixture.parentTitleFieldId]: `CAS filler ${offset + index}` },
        }))
      ))
    );
  }
  return created;
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

const readParentState = async (ctx: SharedTestContext, fixture: Fixture) => {
  const result = await sql<{
    version: number;
    link_a: unknown;
    link_b: unknown;
  }>`
    SELECT ${sql.ref('__version')} AS version,
      ${sql.ref(fixture.parentLinkAColumn)} AS link_a,
      ${sql.ref(fixture.parentLinkBColumn)} AS link_b
    FROM ${sql.table(fixture.parentDbTableName)}
    WHERE ${sql.ref('__id')} = ${fixture.parentP.id}
  `.execute(ctx.testContainer.db);
  const row = result.rows[0];
  if (!row) throw new Error('Missing parent P state');
  return row;
};

const readChildState = async (ctx: SharedTestContext, fixture: Fixture): Promise<ChildState> => {
  const result = await sql<ChildState>`
    SELECT xmin::text AS xmin, ctid::text AS ctid,
      ${sql.ref(fixture.ownerAColumn)} AS owner_a,
      ${sql.ref(fixture.ownerBColumn)} AS owner_b,
      ${sql.ref(fixture.childInverseAColumn)} AS inverse_a,
      ${sql.ref(fixture.childInverseBColumn)} AS inverse_b
    FROM ${sql.table(fixture.childDbTableName)}
    WHERE ${sql.ref('__id')} = ${fixture.childX.id}
  `.execute(ctx.testContainer.db);
  const row = result.rows[0];
  if (!row) throw new Error('Missing child X state');
  return row;
};

const expectDamagedFixture = async (
  ctx: SharedTestContext,
  fixture: Fixture
): Promise<{ parentVersion: number; childGeneration: Pick<ChildState, 'xmin' | 'ctid'> }> => {
  const parent = await readParentState(ctx, fixture);
  expect(parent.link_a).toEqual([]);
  expect(parent.link_b).toEqual([]);

  const child = await readChildState(ctx, fixture);
  const inverseValue = { id: fixture.parentP.id, title: 'P' };
  expect(child.owner_a).toBe(fixture.parentP.id);
  expect(child.owner_b).toBe(fixture.parentP.id);
  expect(child.inverse_a).toEqual(inverseValue);
  expect(child.inverse_b).toEqual(inverseValue);
  return {
    parentVersion: parent.version,
    childGeneration: { xmin: child.xmin, ctid: child.ctid },
  };
};

const expectHttpState = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  expected: { linked: boolean }
): Promise<void> => {
  const parents = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
  const children = await ctx.listRecordsWithoutDrain(fixture.childTableId);
  const parent = parents.find(({ id }) => id === fixture.parentP.id);
  const child = children.find(({ id }) => id === fixture.childX.id);
  if (!parent || !child) throw new Error('Missing HTTP-visible P/X records');

  expect(parent.fields[fixture.parentLinkAFieldId] ?? []).toEqual([]);
  expect(parent.fields[fixture.parentLinkBFieldId] ?? []).toEqual([]);
  const expectedInverse = expected.linked ? { id: fixture.parentP.id, title: 'P' } : null;
  expect(child.fields[fixture.childInverseAFieldId] ?? null).toEqual(expectedInverse);
  expect(child.fields[fixture.childInverseBFieldId] ?? null).toEqual(expectedInverse);
};

const transactionAuditNames = (): TransactionAudit => {
  const prefix = `t8242_multifield_tx_${getRandomString(8).toLowerCase()}`;
  return {
    tableName: `${prefix}_audit`,
    functionName: `${prefix}_fn`,
    triggerName: `${prefix}_trg`,
  };
};

const installTransactionAudit = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: TransactionAudit
): Promise<void> => {
  await sql`
    CREATE TABLE ${sql.id('public', names.tableName)} (
      field_name text NOT NULL,
      transaction_id text NOT NULL
    )
  `.execute(ctx.testContainer.db);
  await sql`
    CREATE FUNCTION ${sql.id('public', names.functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF to_jsonb(OLD) ->> TG_ARGV[0] IS NOT NULL
         AND to_jsonb(NEW) ->> TG_ARGV[0] IS NULL THEN
        INSERT INTO ${sql.id('public', names.tableName)} (field_name, transaction_id)
        VALUES ('A', txid_current()::text);
      END IF;
      IF to_jsonb(OLD) ->> TG_ARGV[1] IS NOT NULL
         AND to_jsonb(NEW) ->> TG_ARGV[1] IS NULL THEN
        INSERT INTO ${sql.id('public', names.tableName)} (field_name, transaction_id)
        VALUES ('B', txid_current()::text);
      END IF;
      RETURN NEW;
    END;
    $$
  `.execute(ctx.testContainer.db);
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    AFTER UPDATE ON ${sql.table(fixture.childDbTableName)}
    FOR EACH ROW EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(fixture.ownerAColumn)}, ${sql.lit(fixture.ownerBColumn)}
    )
  `.execute(ctx.testContainer.db);
};

const dropTransactionAudit = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: TransactionAudit
): Promise<void> => {
  await sql`
    DROP TRIGGER IF EXISTS ${sql.id(names.triggerName)}
    ON ${sql.table(fixture.childDbTableName)}
  `.execute(ctx.testContainer.db);
  await sql`DROP FUNCTION IF EXISTS ${sql.id('public', names.functionName)}()`.execute(
    ctx.testContainer.db
  );
  await sql`DROP TABLE IF EXISTS ${sql.id('public', names.tableName)}`.execute(
    ctx.testContainer.db
  );
};

const generationGateNames = (): GenerationGate => {
  const prefix = `t8242_multifield_generation_${getRandomString(8).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    sequenceName: `${prefix}_attempts`,
    triggerName: `${prefix}_trg`,
    gateKey: `${prefix}:before-first-release`,
  };
};

const installGenerationGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: GenerationGate
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
  // The first release statement pauses before it selects or locks X. The ABA below
  // uses later sequence values and can therefore commit a real replacement tuple.
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    BEFORE UPDATE OF ${sql.id(fixture.ownerAColumn)}, ${sql.id(fixture.ownerBColumn)}
    ON ${sql.table(fixture.childDbTableName)}
    FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.sequenceName}`)}, ${sql.lit(names.gateKey)}
    )
  `.execute(ctx.testContainer.db);
};

const dropGenerationGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: GenerationGate
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

const localWriteGateNames = (): LocalWriteGate => {
  const prefix = `t8242_multifield_local_write_${getRandomString(8).toLowerCase()}`;
  return {
    functionName: `${prefix}_fn`,
    sequenceName: `${prefix}_attempts`,
    triggerName: `${prefix}_trg`,
    gateKey: `${prefix}:before-second-field-write`,
  };
};

const installLocalWriteGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: LocalWriteGate
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
  // Only the second internal batch writes link B. Reaching this trigger proves
  // link A's no-op token was returned by the completed first batch.
  await sql`
    CREATE TRIGGER ${sql.id(names.triggerName)}
    BEFORE UPDATE OF ${sql.id(fixture.parentLinkBColumn)}
    ON ${sql.table(fixture.parentDbTableName)}
    FOR EACH STATEMENT EXECUTE FUNCTION ${sql.id('public', names.functionName)}(
      ${sql.lit(`public.${names.sequenceName}`)}, ${sql.lit(names.gateKey)}
    )
  `.execute(ctx.testContainer.db);
};

const dropLocalWriteGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  names: LocalWriteGate
): Promise<void> => {
  await sql`
    DROP TRIGGER IF EXISTS ${sql.id(names.triggerName)}
    ON ${sql.table(fixture.parentDbTableName)}
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
): Promise<void> => {
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
          SELECT 1 FROM pg_locks AS relation_lock
          WHERE relation_lock.pid = activity.pid
            AND relation_lock.relation = ${fixture.childRelationOid}::oid
        )
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return;
    expect(
      result.rows,
      'only the two-field repair should wait at the generation gate'
    ).toHaveLength(0);
    await delay(20);
  }
  throw new Error('Two-field no-op repair did not reach its pre-generation-check gate');
};

const waitForLocalWriteAtGate = async (
  ctx: SharedTestContext,
  fixture: Fixture,
  blockerPid: number
): Promise<void> => {
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
          SELECT 1 FROM pg_locks AS relation_lock
          WHERE relation_lock.pid = activity.pid
            AND relation_lock.relation = ${fixture.parentRelationOid}::oid
        )
    `.execute(ctx.testContainer.db);
    if (result.rows.length === 1) return;
    expect(result.rows, 'only the second link-field batch should wait at this gate').toHaveLength(
      0
    );
    await delay(20);
  }
  throw new Error('Second link-field batch did not reach its PostgreSQL trigger gate');
};

describe('two oneMany fields repair independent no-op snapshots atomically (HTTP/PostgreSQL e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('clears both physical FKs in one transaction while preserving source updatedCount=0', async () => {
    const fixture = await createFixture(ctx);
    const before = await expectDamagedFixture(ctx, fixture);
    const audit = transactionAuditNames();

    try {
      await installTransactionAudit(ctx, fixture, audit);
      const beforeEventCount = ctx.testContainer.eventBus.events().length;
      const result = await postTwoEmptyLinks(ctx, fixture);
      expect(expectUpdateOk(result).updatedCount).toBe(0);

      // updatedCount counts direct source writes only. Repairing P's damaged
      // [] caches to canonical SQL NULL is a real computed change, so it must
      // increment __version and publish computed events for realtime consumers.

      const childAfterCommit = await readChildState(ctx, fixture);
      expect(childAfterCommit.owner_a).toBeNull();
      expect(childAfterCommit.owner_b).toBeNull();

      const auditResult = await sql<{ field_name: string; transaction_id: string }>`
        SELECT field_name, transaction_id
        FROM ${sql.id('public', audit.tableName)}
        ORDER BY field_name
      `.execute(ctx.testContainer.db);
      expect(auditResult.rows.map(({ field_name }) => field_name)).toEqual(['A', 'B']);
      expect(new Set(auditResult.rows.map(({ transaction_id }) => transaction_id)).size).toBe(1);

      await ctx.drainOutbox();
      const parentAfterDrain = await readParentState(ctx, fixture);
      const childAfterDrain = await readChildState(ctx, fixture);
      expect(parentAfterDrain.version).toBe(before.parentVersion + 1);
      expect(parentAfterDrain.link_a).toBeNull();
      expect(parentAfterDrain.link_b).toBeNull();
      expect(childAfterDrain.inverse_a).toBeNull();
      expect(childAfterDrain.inverse_b).toBeNull();
      await expectHttpState(ctx, fixture, { linked: false });

      const repairEvents = ctx.testContainer.eventBus.events().slice(beforeEventCount);
      const parentBatchEvents = repairEvents.filter(
        (event) =>
          isRecordsBatchUpdatedEvent(event) && event.tableId.toString() === fixture.parentTableId
      );
      const parentUpdates = parentBatchEvents
        .filter(isRecordsBatchUpdatedEvent)
        .flatMap((event) =>
          event.updates
            .filter(({ recordId }) => recordId === fixture.parentP.id)
            .map((update) => ({ source: event.source, ...update }))
        );
      expect(parentUpdates).toEqual([
        {
          source: 'computed',
          recordId: fixture.parentP.id,
          oldVersion: before.parentVersion,
          newVersion: before.parentVersion + 1,
          changes: expect.arrayContaining([
            { fieldId: fixture.parentLinkAFieldId, oldValue: [], newValue: null },
            { fieldId: fixture.parentLinkBFieldId, oldValue: [], newValue: null },
          ]),
        },
      ]);
      expect(
        repairEvents.filter(
          (event) =>
            isRecordUpdatedEvent(event) &&
            event.tableId.toString() === fixture.parentTableId &&
            event.recordId.toString() === fixture.parentP.id &&
            event.source !== 'computed'
        )
      ).toHaveLength(0);

      const childUpdates = repairEvents
        .filter(isRecordsBatchUpdatedEvent)
        .flatMap((event) =>
          event.tableId.toString() === fixture.childTableId && event.source === 'computed'
            ? event.updates.filter(({ recordId }) => recordId === fixture.childX.id)
            : []
        );
      expect(childUpdates.flatMap(({ changes }) => changes)).toEqual(
        expect.arrayContaining([
          {
            fieldId: fixture.childInverseAFieldId,
            oldValue: { id: fixture.parentP.id, title: 'P' },
            newValue: null,
          },
          {
            fieldId: fixture.childInverseBFieldId,
            oldValue: { id: fixture.parentP.id, title: 'P' },
            newValue: null,
          },
        ])
      );
    } finally {
      await dropTransactionAudit(ctx, fixture, audit);
    }
  }, 120_000);

  it('conflicts on a real concurrent X generation change and leaves both relationships intact', async () => {
    const fixture = await createFixture(ctx);
    const before = await expectDamagedFixture(ctx, fixture);
    const names = generationGateNames();
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await installGenerationGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.gateKey);

      const repair = postTwoEmptyLinks(ctx, fixture);
      requests.push(repair);
      void Promise.allSettled(requests);
      await Promise.race([
        waitForRepairAtGate(ctx, fixture, gate.pid),
        repair.then((result) => {
          throw new Error(`Repair finished before its generation gate: ${JSON.stringify(result)}`);
        }),
      ]);

      // P -> Q -> P preserves the visible owners but replaces X's physical tuple.
      // This is the control proving the snapshot check observes a real PostgreSQL
      // generation change rather than merely comparing the two FK values.
      await ctx.testContainer.db.transaction().execute(async (trx) => {
        await sql`
          UPDATE ${sql.table(fixture.childDbTableName)}
          SET ${sql.ref(fixture.ownerBColumn)} = ${fixture.parentQ.id}
          WHERE ${sql.ref('__id')} = ${fixture.childX.id}
        `.execute(trx);
        await sql`
          UPDATE ${sql.table(fixture.childDbTableName)}
          SET ${sql.ref(fixture.ownerBColumn)} = ${fixture.parentP.id}
          WHERE ${sql.ref('__id')} = ${fixture.childX.id}
        `.execute(trx);
      });

      const afterAba = await readChildState(ctx, fixture);
      expect({ xmin: afterAba.xmin, ctid: afterAba.ctid }).not.toEqual(before.childGeneration);
      expect(afterAba.owner_a).toBe(fixture.parentP.id);
      expect(afterAba.owner_b).toBe(fixture.parentP.id);
      expect(gate.automaticallyReleased, 'ABA must commit before the repair gate opens').toBe(
        false
      );

      await gate.release();
      const result = await repair;
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(JSON.stringify(result.body)).toContain(
        'conflict.link.noop_release_generation_changed'
      );

      // The HTTP command owns one transaction. A conflict in either relationship
      // must not expose a half-repaired sibling relationship or bump the no-op P.
      const parentAfter = await readParentState(ctx, fixture);
      const childAfter = await readChildState(ctx, fixture);
      expect(parentAfter.version).toBe(before.parentVersion);
      expect(parentAfter.link_a).toEqual([]);
      expect(parentAfter.link_b).toEqual([]);
      expect(childAfter.owner_a).toBe(fixture.parentP.id);
      expect(childAfter.owner_b).toBe(fixture.parentP.id);
      expect(childAfter.inverse_a).toEqual({ id: fixture.parentP.id, title: 'P' });
      expect(childAfter.inverse_b).toEqual({ id: fixture.parentP.id, title: 'P' });
      await expectHttpState(ctx, fixture, { linked: true });
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropGenerationGate(ctx, fixture, names);
    }
  }, 120_000);

  it('rejects an A no-op token changed by ABA before a later B FK write to the same target', async () => {
    const fixture = await createFixture(ctx);
    const fillers = await createParentRecordsInChunks(ctx, fixture, 999);
    expect(fillers).toHaveLength(999);
    await ctx.drainOutbox();

    // Keep A in the damaged no-op state, but make B independently unowned so
    // Q's second-batch link B request is a real write to the same child tuple.
    await sql`
      UPDATE ${sql.table(fixture.childDbTableName)}
      SET ${sql.ref(fixture.ownerBColumn)} = NULL,
          ${sql.ref(fixture.childInverseBColumn)} = NULL
      WHERE ${sql.ref('__id')} = ${fixture.childX.id}
    `.execute(ctx.testContainer.db);

    const beforeParent = await readParentState(ctx, fixture);
    const beforeChild = await readChildState(ctx, fixture);
    expect(beforeParent.link_a).toEqual([]);
    expect(beforeChild.owner_a).toBe(fixture.parentP.id);
    expect(beforeChild.owner_b).toBeNull();
    expect(beforeChild.inverse_a).toEqual({ id: fixture.parentP.id, title: 'P' });
    expect(beforeChild.inverse_b).toBeNull();

    const parentTitleColumn = await fieldDbName(
      ctx,
      fixture.parentTableId,
      fixture.parentTitleFieldId
    );
    const names = localWriteGateNames();
    const requests: Promise<ApiResult>[] = [];
    let gate: HeldGate | undefined;

    try {
      await installLocalWriteGate(ctx, fixture, names);
      gate = await holdGate(ctx, names.gateKey);

      const update = postUpdateRecords(ctx, fixture.parentTableId, [
        { id: fixture.parentP.id, fields: { [fixture.parentLinkAFieldId]: [] } },
        ...fillers.map((record, index) => ({
          id: record.id,
          fields: { [fixture.parentTitleFieldId]: `CAS updated ${index}` },
        })),
        {
          id: fixture.parentQ.id,
          fields: { [fixture.parentLinkBFieldId]: [{ id: fixture.childX.id }] },
        },
      ]);
      requests.push(update);
      void Promise.allSettled(requests);
      await Promise.race([
        waitForLocalWriteAtGate(ctx, fixture, gate.pid),
        update.then((result) => {
          throw new Error(
            `Update finished before its second-batch gate: ${JSON.stringify(result)}`
          );
        }),
      ]);

      // A's visible owner returns to P, but PostgreSQL replaces X's tuple after
      // the first batch captured its no-op token and before B can write X.
      await ctx.testContainer.db.transaction().execute(async (trx) => {
        await sql`
          UPDATE ${sql.table(fixture.childDbTableName)}
          SET ${sql.ref(fixture.ownerAColumn)} = ${fixture.parentQ.id}
          WHERE ${sql.ref('__id')} = ${fixture.childX.id}
        `.execute(trx);
        await sql`
          UPDATE ${sql.table(fixture.childDbTableName)}
          SET ${sql.ref(fixture.ownerAColumn)} = ${fixture.parentP.id}
          WHERE ${sql.ref('__id')} = ${fixture.childX.id}
        `.execute(trx);
      });

      const afterAba = await readChildState(ctx, fixture);
      expect({ xmin: afterAba.xmin, ctid: afterAba.ctid }).not.toEqual({
        xmin: beforeChild.xmin,
        ctid: beforeChild.ctid,
      });
      expect(afterAba.owner_a).toBe(fixture.parentP.id);
      expect(afterAba.owner_b).toBeNull();
      expect(gate.automaticallyReleased, 'ABA must commit before the B-write gate opens').toBe(
        false
      );

      await gate.release();
      const result = await update;
      expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(400);
      expect(result.status, JSON.stringify(result.body)).toBeLessThan(500);
      expect(JSON.stringify(result.body)).toContain(
        'conflict.link.noop_release_generation_changed'
      );

      // The first batch's 999 title writes and the second batch's B link are in
      // the same API transaction; the stale A token must roll all of them back.
      const parentAfter = await readParentState(ctx, fixture);
      const childAfter = await readChildState(ctx, fixture);
      const rolledBackRows = await sql<{
        record_id: string;
        title_value: string;
        link_b: unknown;
      }>`
        SELECT ${sql.ref('__id')} AS record_id,
          ${sql.ref(parentTitleColumn)} AS title_value,
          ${sql.ref(fixture.parentLinkBColumn)} AS link_b
        FROM ${sql.table(fixture.parentDbTableName)}
        WHERE ${sql.ref('__id')} IN (${fillers[0]!.id}, ${fixture.parentQ.id})
      `.execute(ctx.testContainer.db);
      const rowsById = new Map(rolledBackRows.rows.map((row) => [row.record_id, row]));
      expect(rowsById.get(fillers[0]!.id)?.title_value).toBe('CAS filler 0');
      expect(rowsById.get(fixture.parentQ.id)?.link_b ?? null).toBeNull();
      expect(parentAfter.version).toBe(beforeParent.version);
      expect(parentAfter.link_a).toEqual([]);
      expect(childAfter.owner_a).toBe(fixture.parentP.id);
      expect(childAfter.owner_b).toBeNull();
      expect(childAfter.inverse_a).toEqual({ id: fixture.parentP.id, title: 'P' });
      expect(childAfter.inverse_b).toBeNull();
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      await dropLocalWriteGate(ctx, fixture, names);
    }
  }, 180_000);
});
