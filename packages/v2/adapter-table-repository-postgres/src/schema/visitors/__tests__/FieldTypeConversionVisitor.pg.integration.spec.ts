import { randomUUID } from 'node:crypto';

import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import type { Field } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  PostgresQueryCompiler,
  sql,
  type Kysely,
  type KyselyPlugin,
  type Transaction,
} from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { executeTableSchemaStatements } from '../../../shared/db';
import { FieldTypeConversionVisitorFactory } from '../FieldTypeConversionVisitor';
import { createTextField, createUsrField } from './helpers/fieldFactories';

const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const adminUrl =
  process.env.TEABLE_V2_TEST_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;

const FIELD_NAME = 'user_text';
const SCALE_TABLE_ID = `tbl${'s'.repeat(16)}`;
const MULTI_TABLE_ID = `tbl${'m'.repeat(16)}`;
const EMPTY_TABLE_ID = `tbl${'e'.repeat(16)}`;
const FAILURE_TABLE_ID = `tbl${'f'.repeat(16)}`;
const ALTER_FAILURE_TABLE_ID = `tbl${'a'.repeat(16)}`;
const BASE_ID = `bse${'b'.repeat(16)}`;
const EMPTY_BASE_ID = `bse${'e'.repeat(16)}`;
const SPACE_ID = `spc${'s'.repeat(16)}`;
const EMPTY_SPACE_ID = `spc${'e'.repeat(16)}`;
const PROFILE_PAGE_SIZE = 128;
const HUGE_SOURCE_BYTES = 1024 * 1024;
const HUGE_PROFILE_NAME_BYTES = 256 * 1024;

const tableNames = [
  'records_scale',
  'records_multi',
  'records_empty',
  'records_meta_failure',
  'records_alter_failure',
] as const;

type QueryKind =
  | 'profilePage'
  | 'tempCreate'
  | 'tempWrite'
  | 'finalTransform'
  | 'alter'
  | 'explicitLock'
  | 'other';

type QueryMetric = {
  readonly kind: QueryKind;
  readonly queryBytes: number;
  readonly parameterBytes: number;
  readonly resultRows: number;
  readonly resultBytes: number;
};

type QueryProbeSnapshot = {
  readonly metrics: ReadonlyArray<QueryMetric>;
  readonly maxQueryBytes: number;
  readonly maxParameterBytes: number;
  readonly maxResultRows: number;
  readonly maxResultBytes: number;
};

const bytesOf = (value: unknown): number => {
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (Buffer.isBuffer(value)) return value.byteLength;
  const serialized = JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item
  );
  return Buffer.byteLength(serialized ?? '');
};

const classifyQuery = (query: string): QueryKind => {
  const normalized = query.toLowerCase().replace(/\s+/g, ' ').replaceAll('"', '');
  if (/\block table\b/.test(normalized)) return 'explicitLock';
  if (
    normalized.includes(' from pg_temp.tmp_user_conversion_') &&
    normalized.includes('_meta') &&
    normalized.includes(' limit ')
  ) {
    return 'profilePage';
  }
  if (normalized.includes('create temp') && normalized.includes('user_conversion')) {
    return 'tempCreate';
  }
  if (normalized.includes('insert into') && normalized.includes('user_conversion')) {
    return 'tempWrite';
  }
  if (
    normalized.includes('update') &&
    normalized.includes('user_conversion') &&
    normalized.includes('regexp_split')
  ) {
    return 'finalTransform';
  }
  if (normalized.includes('alter table') && normalized.includes('type jsonb')) return 'alter';
  return 'other';
};

const maxMetric = (metrics: ReadonlyArray<QueryMetric>, key: keyof Omit<QueryMetric, 'kind'>) =>
  metrics.reduce((maximum, metric) => Math.max(maximum, metric[key]), 0);

const createQueryProbe = (
  options: {
    failProfilePage?: number;
    afterFirstProfilePage?: () => Promise<void>;
  } = {}
) => {
  const compiler = new PostgresQueryCompiler();
  const pending = new WeakMap<object, Omit<QueryMetric, 'resultRows' | 'resultBytes'>>();
  let metrics: QueryMetric[] = [];
  let profilePage = 0;

  const plugin = {
    transformQuery(args) {
      const compiled = compiler.compileQuery(args.node);
      pending.set(args.queryId, {
        kind: classifyQuery(compiled.sql),
        queryBytes: Buffer.byteLength(compiled.sql),
        parameterBytes: compiled.parameters.reduce(
          (total, parameter) => total + bytesOf(parameter),
          0
        ),
      });
      return args.node;
    },
    async transformResult(args) {
      const query = pending.get(args.queryId);
      pending.delete(args.queryId);
      if (query) {
        const metric: QueryMetric = {
          ...query,
          resultRows: args.result.rows.length,
          resultBytes: bytesOf(args.result.rows),
        };
        metrics.push(metric);
        if (metric.kind === 'profilePage') {
          profilePage += 1;
          if (profilePage === 1) await options.afterFirstProfilePage?.();
          if (profilePage === options.failProfilePage) {
            throw new Error(`injected metadata profile page ${profilePage} failure`);
          }
        }
      }
      return args.result;
    },
  } satisfies KyselyPlugin;

  return {
    plugin,
    reset: () => {
      metrics = [];
      profilePage = 0;
    },
    snapshot: (): QueryProbeSnapshot => ({
      metrics: [...metrics],
      maxQueryBytes: maxMetric(metrics, 'queryBytes'),
      maxParameterBytes: maxMetric(metrics, 'parameterBytes'),
      maxResultRows: maxMetric(metrics, 'resultRows'),
      maxResultBytes: maxMetric(metrics, 'resultBytes'),
    }),
  };
};

const reportConversionMetrics = (
  scenario: string,
  data: QueryProbeSnapshot,
  meta: QueryProbeSnapshot
): void => {
  if (process.env.TEABLE_V2_REPORT_CONVERSION_METRICS !== '1') return;
  const summarize = (snapshot: QueryProbeSnapshot) => ({
    queryCount: snapshot.metrics.length,
    maxQueryBytes: snapshot.maxQueryBytes,
    maxParameterBytes: snapshot.maxParameterBytes,
    maxResultRows: snapshot.maxResultRows,
    maxResultBytes: snapshot.maxResultBytes,
    profilePageRows: snapshot.metrics
      .filter((metric) => metric.kind === 'profilePage')
      .map((metric) => metric.resultRows),
  });
  console.info(
    JSON.stringify({
      scenario,
      data: summarize(data),
      meta: summarize(meta),
    })
  );
};

const databaseUrl = (connectionString: string, database: string): string => {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};

const executeConversion = async (
  dataDb: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
  metaDb: Kysely<V1TeableDatabase>,
  tableName: string,
  tableId: string,
  sourceField: Field,
  targetField: Field
): Promise<void> => {
  const factory = new FieldTypeConversionVisitorFactory({
    db: dataDb,
    schema: null,
    tableName,
    tableId,
    dbFieldName: FIELD_NAME,
  });
  const visitor = sourceField.accept(factory)._unsafeUnwrap();
  const statements = targetField.accept(visitor)._unsafeUnwrap();
  if (metaDb.isTransaction) {
    await executeTableSchemaStatements(dataDb, statements, {
      dataDb,
      metaDb,
      enforceRelationAccess: true,
    });
  } else {
    await metaDb.transaction().execute((metaTx) =>
      executeTableSchemaStatements(dataDb, statements, {
        dataDb,
        metaDb: metaTx,
        enforceRelationAccess: true,
      })
    );
  }
};

const convertTextToUser = async (
  dataDb: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
  metaDb: Kysely<V1TeableDatabase>,
  tableName: string,
  tableId: string,
  multiple: boolean
): Promise<void> =>
  executeConversion(
    dataDb,
    metaDb,
    tableName,
    tableId,
    createTextField(`source-${tableName}`, 'Source text', FIELD_NAME)._unsafeUnwrap(),
    createUsrField(`target-${tableName}`, 'Target user', FIELD_NAME, multiple)._unsafeUnwrap()
  );

const userSnapshot = (id: string, title: string, email: string | null) => ({
  id,
  title,
  email,
});

describePg('FieldTypeConversionVisitor text-to-user (Postgres)', () => {
  let adminDb: Kysely<V1TeableDatabase> | undefined;
  let ownedDataDb: Kysely<V1TeableDatabase> | undefined;
  let ownedMetaDb: Kysely<V1TeableDatabase> | undefined;
  let dataDb: Kysely<V1TeableDatabase>;
  let metaDb: Kysely<V1TeableDatabase>;
  let dataDatabase = '';
  let metaDatabase = '';
  const dataProbe = createQueryProbe();
  const metaProbe = createQueryProbe();

  beforeAll(async () => {
    if (!adminUrl) {
      throw new Error(
        'TEABLE_V2_RUN_PG_INTEGRATION=1 requires TEABLE_V2_TEST_DATABASE_URL, PRISMA_DATABASE_URL, or DATABASE_URL'
      );
    }

    const suffix = `${process.pid}_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    dataDatabase = `v2_ftc_data_${suffix}`.slice(0, 63);
    metaDatabase = `v2_ftc_meta_${suffix}`.slice(0, 63);
    adminDb = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString: adminUrl, pool: { max: 1 } },
    });
    await sql.raw(`CREATE DATABASE "${dataDatabase}"`).execute(adminDb);
    await sql.raw(`CREATE DATABASE "${metaDatabase}"`).execute(adminDb);

    ownedDataDb = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString: databaseUrl(adminUrl, dataDatabase), pool: { max: 2 } },
    });
    ownedMetaDb = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString: databaseUrl(adminUrl, metaDatabase), pool: { max: 2 } },
    });
    dataDb = ownedDataDb.withPlugin(dataProbe.plugin);
    metaDb = ownedMetaDb.withPlugin(metaProbe.plugin);

    await sql`
      CREATE TABLE users (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text,
        deleted_time timestamptz
      )
    `.execute(metaDb);
    await sql`CREATE TABLE base (id text PRIMARY KEY, space_id text NOT NULL)`.execute(metaDb);
    await sql`CREATE TABLE table_meta (id text PRIMARY KEY, base_id text NOT NULL)`.execute(metaDb);
    await sql`
      CREATE TABLE collaborator (
        id text PRIMARY KEY,
        resource_type text NOT NULL,
        resource_id text NOT NULL,
        principal_id text NOT NULL,
        principal_type text NOT NULL,
        created_time timestamptz NOT NULL DEFAULT now()
      )
    `.execute(metaDb);
  });

  afterAll(async () => {
    await ownedDataDb?.destroy();
    await ownedMetaDb?.destroy();
    if (adminDb) {
      if (dataDatabase) {
        await sql.raw(`DROP DATABASE IF EXISTS "${dataDatabase}" WITH (FORCE)`).execute(adminDb);
      }
      if (metaDatabase) {
        await sql.raw(`DROP DATABASE IF EXISTS "${metaDatabase}" WITH (FORCE)`).execute(adminDb);
      }
      await adminDb.destroy();
    }
  });

  beforeEach(async () => {
    for (const tableName of tableNames) {
      await sql.raw(`DROP TABLE IF EXISTS "${tableName}"`).execute(dataDb);
    }
    await sql`TRUNCATE TABLE collaborator, table_meta, base, users`.execute(metaDb);
    dataProbe.reset();
    metaProbe.reset();
  });

  afterEach(async () => {
    for (const db of [dataDb, metaDb]) {
      const { rows } = await sql<{ relname: string }>`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname LIKE 'pg_temp_%' AND c.relname LIKE 'tmp_user_conversion_%'
      `.execute(db);
      expect(rows).toEqual([]);
    }
  });

  const seedProfiles = async (...tableIds: ReadonlyArray<string>): Promise<void> => {
    await sql`INSERT INTO base (id, space_id) VALUES (${BASE_ID}, ${SPACE_ID})`.execute(metaDb);
    for (const tableId of tableIds) {
      await sql`INSERT INTO table_meta (id, base_id) VALUES (${tableId}, ${BASE_ID})`.execute(
        metaDb
      );
    }
    await sql`
      INSERT INTO users (id, name, email, deleted_time)
      SELECT
        'usr_' || lpad(g::text, 3, '0'),
        'User ' || lpad(g::text, 3, '0'),
        'user' || lpad(g::text, 3, '0') || '@example.com',
        NULL
      FROM generate_series(0, 299) AS generated(g)
    `.execute(metaDb);
    await sql`
      UPDATE users
      SET
        name = CASE
          WHEN id = 'usr_298' THEN repeat('N', ${HUGE_PROFILE_NAME_BYTES})
          WHEN id IN ('usr_050', 'usr_200') THEN 'Cross Page Name'
          WHEN id = 'usr_012' THEN 'usr_010'
          WHEN id = 'usr_021' THEN 'priority@example.com'
          ELSE name
        END,
        email = CASE
          WHEN id = 'usr_011' THEN 'usr_010'
          WHEN id = 'usr_020' THEN 'priority@example.com'
          ELSE email
        END
    `.execute(metaDb);
    await sql`
      INSERT INTO users (id, name, email, deleted_time)
      VALUES ('usr_outsider', 'Outsider', 'outsider@example.com', NULL)
    `.execute(metaDb);
    await sql`
      INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type)
      SELECT
        'col_' || lpad(g::text, 3, '0'),
        'base',
        ${BASE_ID},
        'usr_' || lpad(g::text, 3, '0'),
        'user'
      FROM generate_series(0, 299) AS generated(g)
    `.execute(metaDb);
  };

  const expectBoundedPlan = (data: QueryProbeSnapshot, meta: QueryProbeSnapshot): void => {
    const profilePages = meta.metrics.filter((metric) => metric.kind === 'profilePage');
    expect(profilePages.map((metric) => metric.resultRows)).toEqual([128, 128, 44, 0]);
    expect(meta.maxResultRows).toBeLessThanOrEqual(PROFILE_PAGE_SIZE);
    expect(data.metrics.filter((metric) => metric.kind === 'tempCreate')).toHaveLength(1);
    expect(data.metrics.filter((metric) => metric.kind === 'tempWrite')).toHaveLength(3);
    expect(data.metrics.filter((metric) => metric.kind === 'finalTransform')).toHaveLength(1);
    expect(data.metrics.filter((metric) => metric.kind === 'alter')).toHaveLength(1);
    expect(data.metrics.filter((metric) => metric.kind === 'explicitLock')).toHaveLength(0);

    // A profile itself may be large, so metadata result bytes are deliberately not capped.
    // The 1 MiB source dataset still never enters a query result or query parameter: only the
    // eligible 256 KiB profile crosses connections and the data statements return no rows.
    expect(meta.maxResultBytes).toBeGreaterThanOrEqual(HUGE_PROFILE_NAME_BYTES);
    expect(data.maxParameterBytes).toBeGreaterThanOrEqual(HUGE_PROFILE_NAME_BYTES);
    expect(data.maxResultRows).toBe(0);
    expect(data.maxResultBytes).toBe(bytesOf([]));
    expect(Math.max(data.maxQueryBytes, meta.maxQueryBytes)).toBeLessThan(HUGE_PROFILE_NAME_BYTES);
    expect(meta.maxParameterBytes).toBeLessThan(HUGE_PROFILE_NAME_BYTES);
  };

  it('pages eligible profiles and performs one set-based transform without materializing source text', async () => {
    await seedProfiles(SCALE_TABLE_ID, MULTI_TABLE_ID);
    await sql`CREATE TABLE records_scale (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
    await sql`
      INSERT INTO records_scale (__id, user_text)
      SELECT
        'bulk_' || lpad(g::text, 5, '0'),
        'unknown_' || lpad(g::text, 5, '0')
      FROM generate_series(1, 10000) AS generated(g)
    `.execute(dataDb);
    await sql`
      INSERT INTO records_scale (__id, user_text)
      VALUES
        ('rec_email_priority', 'priority@example.com'),
        ('rec_huge_late', repeat('x', ${HUGE_SOURCE_BYTES}) || ',user299@example.com'),
        ('rec_huge_name', repeat('N', ${HUGE_PROFILE_NAME_BYTES})),
        ('rec_id_priority', 'usr_010'),
        ('rec_json_outsider', '{"id":"usr_outsider","title":"Outsider"}'),
        ('rec_name_cross_page', 'Cross Page Name'),
        ('rec_single_repeat', 'User 001, User 001')
    `.execute(dataDb);

    dataProbe.reset();
    metaProbe.reset();
    await dataDb
      .transaction()
      .execute((tx) => convertTextToUser(tx, metaDb, 'records_scale', SCALE_TABLE_ID, false));
    const singleDataMetrics = dataProbe.snapshot();
    const singleMetaMetrics = metaProbe.snapshot();
    expectBoundedPlan(singleDataMetrics, singleMetaMetrics);
    reportConversionMetrics('single-user', singleDataMetrics, singleMetaMetrics);

    const singleRows = await sql<{ __id: string; user_text: unknown | null }>`
      SELECT __id, user_text
      FROM records_scale
      WHERE __id LIKE 'rec_%' AND __id <> 'rec_huge_name'
      ORDER BY __id
    `.execute(dataDb);
    expect(singleRows.rows).toEqual([
      {
        __id: 'rec_email_priority',
        user_text: userSnapshot('usr_020', 'User 020', 'priority@example.com'),
      },
      {
        __id: 'rec_huge_late',
        user_text: userSnapshot('usr_299', 'User 299', 'user299@example.com'),
      },
      {
        __id: 'rec_id_priority',
        user_text: userSnapshot('usr_010', 'User 010', 'user010@example.com'),
      },
      { __id: 'rec_json_outsider', user_text: null },
      {
        __id: 'rec_name_cross_page',
        user_text: userSnapshot('usr_050', 'Cross Page Name', 'user050@example.com'),
      },
      {
        __id: 'rec_single_repeat',
        user_text: userSnapshot('usr_001', 'User 001', 'user001@example.com'),
      },
    ]);
    const hugeProfile = await sql<{
      id: string;
      title_bytes: number;
      email: string | null;
    }>`
      SELECT
        user_text->>'id' AS id,
        octet_length(user_text->>'title') AS title_bytes,
        user_text->>'email' AS email
      FROM records_scale
      WHERE __id = 'rec_huge_name'
    `.execute(dataDb);
    expect(hugeProfile.rows).toEqual([
      {
        id: 'usr_298',
        title_bytes: HUGE_PROFILE_NAME_BYTES,
        email: 'user298@example.com',
      },
    ]);
    const unmatched = await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM records_scale
      WHERE __id LIKE 'bulk_%' AND user_text IS NOT NULL
    `.execute(dataDb);
    expect(unmatched.rows).toEqual([{ count: '0' }]);

    await sql`CREATE TABLE records_multi (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
    await sql`
      INSERT INTO records_multi (__id, user_text)
      VALUES
        ('rec_multi', 'User 001, User 001, Outsider, User 129'),
        ('rec_multi_json_outsider', '{"id":"usr_outsider","title":"Outsider"}')
    `.execute(dataDb);
    dataProbe.reset();
    metaProbe.reset();
    await dataDb
      .transaction()
      .execute((tx) => convertTextToUser(tx, metaDb, 'records_multi', MULTI_TABLE_ID, true));
    const multiDataMetrics = dataProbe.snapshot();
    const multiMetaMetrics = metaProbe.snapshot();
    expectBoundedPlan(multiDataMetrics, multiMetaMetrics);
    reportConversionMetrics('multiple-user', multiDataMetrics, multiMetaMetrics);

    const multipleRows = await sql<{ __id: string; user_text: unknown | null }>`
      SELECT __id, user_text
      FROM records_multi
      ORDER BY __id
    `.execute(dataDb);
    expect(multipleRows.rows).toEqual([
      {
        __id: 'rec_multi',
        user_text: [
          userSnapshot('usr_001', 'User 001', 'user001@example.com'),
          userSnapshot('usr_001', 'User 001', 'user001@example.com'),
          userSnapshot('usr_129', 'User 129', 'user129@example.com'),
        ],
      },
      { __id: 'rec_multi_json_outsider', user_text: null },
    ]);
  });

  it('clears populated source values when the table has no eligible profiles', async () => {
    await sql`INSERT INTO base (id, space_id) VALUES (${EMPTY_BASE_ID}, ${EMPTY_SPACE_ID})`.execute(
      metaDb
    );
    await sql`
      INSERT INTO table_meta (id, base_id) VALUES (${EMPTY_TABLE_ID}, ${EMPTY_BASE_ID})
    `.execute(metaDb);
    await sql`
      INSERT INTO users (id, name, email, deleted_time)
      VALUES ('usr_outsider', 'Outsider', 'outsider@example.com', NULL)
    `.execute(metaDb);
    await sql`CREATE TABLE records_empty (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
    await sql`
      INSERT INTO records_empty (__id, user_text)
      VALUES ('rec_empty_scope', '{"id":"usr_outsider","title":"Outsider"}')
    `.execute(dataDb);

    dataProbe.reset();
    metaProbe.reset();
    await dataDb
      .transaction()
      .execute((tx) => convertTextToUser(tx, metaDb, 'records_empty', EMPTY_TABLE_ID, false));
    const profilePages = metaProbe
      .snapshot()
      .metrics.filter((metric) => metric.kind === 'profilePage');
    expect(profilePages.map((metric) => metric.resultRows)).toEqual([0]);
    const rows = await sql<{ user_text: unknown | null }>`
      SELECT user_text FROM records_empty
    `.execute(dataDb);
    expect(rows.rows).toEqual([{ user_text: null }]);
    const column = await sql<{ data_type: string }>`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'records_empty' AND column_name = 'user_text'
    `.execute(dataDb);
    expect(column.rows).toEqual([{ data_type: 'jsonb' }]);
  });

  it('rolls back when a later metadata profile page fails', async () => {
    await seedProfiles(FAILURE_TABLE_ID);
    await sql`CREATE TABLE records_meta_failure (__id text PRIMARY KEY, user_text text)`.execute(
      dataDb
    );
    await sql`
      INSERT INTO records_meta_failure (__id, user_text)
      VALUES ('rec_failure', 'User 001')
    `.execute(dataDb);
    const failingMetaProbe = createQueryProbe({ failProfilePage: 2 });
    const failingMetaDb = metaDb.withPlugin(failingMetaProbe.plugin);

    await expect(
      dataDb
        .transaction()
        .execute((tx) =>
          convertTextToUser(tx, failingMetaDb, 'records_meta_failure', FAILURE_TABLE_ID, false)
        )
    ).rejects.toMatchObject({ message: expect.stringMatching(/lookup users|profile page 2/i) });
    expect(
      (
        await sql<{ user_text: string }>`
          SELECT user_text FROM records_meta_failure WHERE __id = 'rec_failure'
        `.execute(dataDb)
      ).rows
    ).toEqual([{ user_text: 'User 001' }]);
    const column = await sql<{ data_type: string }>`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'records_meta_failure'
        AND column_name = 'user_text'
    `.execute(dataDb);
    expect(column.rows).toEqual([{ data_type: 'text' }]);
    expect(
      failingMetaProbe
        .snapshot()
        .metrics.filter((metric) => metric.kind === 'profilePage')
        .map((metric) => metric.resultRows)
    ).toEqual([128, 128]);
  });

  it('uses one authorization and profile snapshot across metadata pages under concurrent revocation', async () => {
    await seedProfiles(SCALE_TABLE_ID);
    await sql`CREATE TABLE records_scale (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
    await sql`
      INSERT INTO records_scale (__id, user_text) VALUES
        ('early', 'usr_001'), ('late', 'usr_299'), ('new-grant', 'usr_outsider'), ('profile', 'usr_200')
    `.execute(dataDb);
    let changed = false;
    const concurrentProbe = createQueryProbe({
      afterFirstProfilePage: async () => {
        // A different metadata connection commits after the first bounded page.
        // Page-by-page READ COMMITTED would retain the early revoked user but
        // drop the late one and include a newly granted outsider: no single
        // authorization snapshot can produce that mixture.
        await ownedMetaDb!.transaction().execute(async (tx) => {
          await sql`DELETE FROM collaborator WHERE principal_id IN ('usr_001', 'usr_299')`.execute(
            tx
          );
          await sql`UPDATE users SET email = 'changed-after-capture@example.invalid' WHERE id = 'usr_299'`.execute(
            tx
          );
          await sql`UPDATE users SET email = 'updated-visible@example.invalid' WHERE id = 'usr_200'`.execute(
            tx
          );
          await sql`
            INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type)
            VALUES ('col_new_grant', 'base', ${BASE_ID}, 'usr_outsider', 'user')
          `.execute(tx);
        });
        changed = true;
      },
    });
    const concurrentMetaDb = metaDb.withPlugin(concurrentProbe.plugin);
    await concurrentMetaDb.transaction().execute(async (metaTx) => {
      // Override even a server/session default of REPEATABLE READ: the old
      // per-page implementation must expose the committed interleaving.
      await sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`.execute(metaTx);
      await dataDb
        .transaction()
        .execute((dataTx) =>
          convertTextToUser(dataTx, metaTx, 'records_scale', SCALE_TABLE_ID, false)
        );
    });
    expect(changed).toBe(true);
    const { rows } = await sql<{ __id: string; user_text: unknown }>`
      SELECT __id, user_text FROM records_scale ORDER BY __id
    `.execute(dataDb);
    expect(rows).toEqual([
      { __id: 'early', user_text: userSnapshot('usr_001', 'User 001', 'user001@example.com') },
      { __id: 'late', user_text: userSnapshot('usr_299', 'User 299', 'user299@example.com') },
      { __id: 'new-grant', user_text: null },
      {
        __id: 'profile',
        user_text: userSnapshot('usr_200', 'Cross Page Name', 'user200@example.com'),
      },
    ]);
    expect(concurrentProbe.snapshot().maxResultRows).toBeLessThanOrEqual(PROFILE_PAGE_SIZE);
  });

  it('rolls back capture and source data on a real metadata statement timeout', async () => {
    await seedProfiles(FAILURE_TABLE_ID);
    await sql`CREATE TABLE records_meta_failure (__id text PRIMARY KEY, user_text text)`.execute(
      dataDb
    );
    await sql`INSERT INTO records_meta_failure VALUES ('timeout', 'User 001')`.execute(dataDb);
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const blocker = ownedMetaDb!.transaction().execute(async (tx) => {
      await sql`LOCK TABLE users IN ACCESS EXCLUSIVE MODE`.execute(tx);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    try {
      await expect(
        metaDb.transaction().execute(async (metaTx) => {
          await sql`SET LOCAL statement_timeout = '50ms'`.execute(metaTx);
          await dataDb
            .transaction()
            .execute((dataTx) =>
              convertTextToUser(dataTx, metaTx, 'records_meta_failure', FAILURE_TABLE_ID, false)
            );
        })
      ).rejects.toMatchObject({
        message: 'Failed to lookup users',
        details: { error: expect.stringMatching(/statement timeout/i) },
      });
    } finally {
      release.resolve();
      await blocker;
    }
    const result = await sql<{
      user_text: string;
    }>`SELECT user_text FROM records_meta_failure`.execute(dataDb);
    expect(result.rows).toEqual([{ user_text: 'User 001' }]);
    for (const db of [dataDb, metaDb]) {
      const temporary = await sql<{ relname: string }>`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname LIKE 'pg_temp_%' AND c.relname LIKE 'tmp_user_conversion_%'
      `.execute(db);
      expect(temporary.rows).toEqual([]);
    }
  });

  it('uses one shared transaction when metadata and records are in the same physical database', async () => {
    await seedProfiles(SCALE_TABLE_ID);
    await metaDb.transaction().execute(async (tx) => {
      await sql`CREATE TABLE records_shared (__id text PRIMARY KEY, user_text text)`.execute(tx);
      await sql`INSERT INTO records_shared VALUES ('shared', 'User 001')`.execute(tx);
      await convertTextToUser(tx, tx, 'records_shared', SCALE_TABLE_ID, false);
      const result = await sql<{
        user_text: unknown;
      }>`SELECT user_text FROM records_shared`.execute(tx);
      expect(result.rows).toEqual([
        {
          user_text: userSnapshot('usr_001', 'User 001', 'user001@example.com'),
        },
      ]);
      const temporary = await sql<{ relname: string }>`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname LIKE 'pg_temp_%' AND c.relname LIKE 'tmp_user_conversion_%'
      `.execute(tx);
      expect(temporary.rows).toEqual([]);
      await sql`DROP TABLE records_shared`.execute(tx);
    });
  });

  it('rolls back transformed values when the final ALTER rejects an incompatible default', async () => {
    await seedProfiles(ALTER_FAILURE_TABLE_ID);
    await sql`
      CREATE TABLE records_alter_failure (
        __id text PRIMARY KEY,
        user_text text DEFAULT 'legacy-default'
      )
    `.execute(dataDb);
    await sql`
      INSERT INTO records_alter_failure (__id, user_text)
      VALUES ('rec_alter_failure', 'User 001')
    `.execute(dataDb);

    await expect(
      dataDb
        .transaction()
        .execute((tx) =>
          convertTextToUser(tx, metaDb, 'records_alter_failure', ALTER_FAILURE_TABLE_ID, false)
        )
    ).rejects.toThrow(/default.*cannot be cast|cannot be cast automatically/i);
    expect(
      (
        await sql<{ user_text: string }>`
          SELECT user_text FROM records_alter_failure WHERE __id = 'rec_alter_failure'
        `.execute(dataDb)
      ).rows
    ).toEqual([{ user_text: 'User 001' }]);
    const column = await sql<{ data_type: string; column_default: string | null }>`
      SELECT data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'records_alter_failure'
        AND column_name = 'user_text'
    `.execute(dataDb);
    expect(column.rows[0]?.data_type).toBe('text');
    expect(column.rows[0]?.column_default).toContain('legacy-default');
  });
});
