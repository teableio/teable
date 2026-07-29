import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  RecordSearch,
  Table,
  TableId,
  TableName,
  type IRecordSearchAccessPath,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRecordSearchWhereClause } from './RecordSearchWhereBuilder';

const runJiebaAcceptance = process.env.TEABLE_V2_RUN_SEARCH_VECTOR_JIEBA_INTEGRATION === '1';
const testDatabaseUrl = process.env.PRISMA_DATABASE_URL;
if (runJiebaAcceptance && !testDatabaseUrl) {
  throw new Error('TEABLE_V2_RUN_SEARCH_VECTOR_JIEBA_INTEGRATION=1 requires PRISMA_DATABASE_URL');
}
const describeWithJieba = runJiebaAcceptance ? describe : describe.skip;

const chineseSearchCases = [
  {
    name: 'complete contiguous Chinese token',
    search: '上海订单已完成',
    expectedDefault: ['alpha'],
    expectedSimple: ['alpha'],
    expectedJieba: ['alpha'],
  },
  {
    name: 'meaningful Chinese prefix',
    search: '上海订单',
    expectedDefault: ['alpha'],
    expectedSimple: [],
    expectedJieba: ['alpha'],
  },
  {
    name: 'shared Chinese business term',
    search: '订单',
    expectedDefault: ['alpha', 'bravo'],
    expectedSimple: [],
    expectedJieba: ['alpha', 'bravo'],
  },
  {
    name: 'complete cancelled-order token',
    search: '已取消订单',
    expectedDefault: ['bravo'],
    expectedSimple: ['bravo'],
    expectedJieba: ['bravo'],
  },
  {
    name: 'Chinese suffix inside a larger token',
    search: '取消订单',
    expectedDefault: ['bravo'],
    expectedSimple: [],
    expectedJieba: ['bravo'],
  },
  {
    name: 'structured identifier and Chinese terms',
    search: 'SO-123456 上海订单已完成',
    expectedDefault: ['alpha'],
    expectedSimple: ['alpha'],
    expectedJieba: ['alpha'],
  },
] as const;

const sanitizeIdSeed = (seed: string): string => seed.replace(/[^0-9a-z]/gi, '0');
const createId = (prefix: string, seed: string): string =>
  `${prefix}${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;

describeWithJieba('RecordSearchWhereBuilder native pg_jieba semantics', () => {
  let db: Kysely<V1TeableDatabase>;
  let table: Table;
  let fieldId: FieldId;
  let schemaName: string;
  let fullTableName: string;

  const recordIds = {
    alpha: createId('rec', 'jieba-alpha'),
    bravo: createId('rec', 'jieba-bravo'),
  } as const;

  beforeAll(async () => {
    db = await createV2PostgresDb<V1TeableDatabase>({
      pg: {
        connectionString: testDatabaseUrl!,
        pool: {
          max: 1,
          allowExitOnIdle: true,
        },
      },
    });

    await sql`CREATE EXTENSION IF NOT EXISTS pg_jieba`.execute(db);

    const baseId = BaseId.create(createId('bse', 'jieba-semantics'))._unsafeUnwrap();
    const tableId = TableId.create(createId('tbl', 'jieba-semantics'))._unsafeUnwrap();
    fieldId = FieldId.create(createId('fld', 'jieba-name'))._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Jieba Search Semantics')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(fieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();
    table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(fieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    schemaName = `tqops_jieba_${process.pid}_${Date.now()}`;
    fullTableName = `${schemaName}.records`;
    await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
    await sql`
      CREATE TABLE ${sql.table(fullTableName)} (
        __id text PRIMARY KEY,
        __auto_number integer NOT NULL,
        col_name text,
        __tqops_search_vector_simple tsvector GENERATED ALWAYS AS (
          to_tsvector('simple'::regconfig, COALESCE(col_name, ''))
        ) STORED,
        __tqops_search_vector_jiebacfg tsvector GENERATED ALWAYS AS (
          to_tsvector('jiebacfg'::regconfig, COALESCE(col_name, ''))
        ) STORED,
        __tqops_search_vector_jiebaqry tsvector GENERATED ALWAYS AS (
          to_tsvector('jiebaqry'::regconfig, COALESCE(col_name, ''))
        ) STORED
      )
    `.execute(db);
    await sql`
      INSERT INTO ${sql.table(fullTableName)} (__id, __auto_number, col_name)
      VALUES
        (${recordIds.alpha}, 1, 'Alpha Order SO-123456 上海订单已完成'),
        (${recordIds.bravo}, 2, 'Bravo Order SO-654321 已取消订单')
    `.execute(db);
    await sql`
      CREATE INDEX idx_tqops_jieba_simple
      ON ${sql.table(fullTableName)} USING GIN (__tqops_search_vector_simple)
    `.execute(db);
    await sql`
      CREATE INDEX idx_tqops_jieba_mix
      ON ${sql.table(fullTableName)} USING GIN (__tqops_search_vector_jiebacfg)
    `.execute(db);
    await sql`
      CREATE INDEX idx_tqops_jieba_query
      ON ${sql.table(fullTableName)} USING GIN (__tqops_search_vector_jiebaqry)
    `.execute(db);
  });

  afterAll(async () => {
    if (db && schemaName) {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schemaName)} CASCADE`.execute(db);
    }
    await db?.destroy();
  });

  it('loads the native jieba text search configurations', async () => {
    const result = await sql<{ cfgname: string }>`
      SELECT cfgname
      FROM pg_ts_config
      WHERE cfgname IN ('simple', 'jiebacfg', 'jiebaqry')
      ORDER BY cfgname
    `.execute(db);

    expect(result.rows.map((row) => row.cfgname)).toEqual(['jiebacfg', 'jiebaqry', 'simple']);

    const vectors = await sql<{ cfg: string; vector: string }>`
      SELECT
        cfg,
        to_tsvector(cfg::regconfig, '上海订单已完成')::text AS vector
      FROM (VALUES ('simple'), ('jiebacfg'), ('jiebaqry')) AS configs(cfg)
    `.execute(db);
    const vectorByConfig = Object.fromEntries(
      vectors.rows.map((row) => [row.cfg, row.vector] as const)
    );

    expect(vectorByConfig.simple).toBe(`'上海订单已完成':1`);
    expect(vectorByConfig.jiebacfg).toContain(`'上海'`);
    expect(vectorByConfig.jiebacfg).toContain(`'订单'`);
    expect(vectorByConfig.jiebacfg).toContain(`'完成'`);
    expect(vectorByConfig.jiebaqry).toContain(`'订单'`);
  });

  it.each(chineseSearchCases)(
    'compares ILIKE, simple, jiebacfg, and jiebaqry for $name',
    async ({ search, expectedDefault, expectedSimple, expectedJieba }) => {
      const expectedIds = (names: ReadonlyArray<'alpha' | 'bravo'>) =>
        names.map((name) => recordIds[name]);

      await expect(findMatchingRecordIds({ search })).resolves.toEqual(
        expectedIds(expectedDefault)
      );
      await expect(findMatchingRecordIds({ search, languageConfig: 'simple' })).resolves.toEqual(
        expectedIds(expectedSimple)
      );
      await expect(findMatchingRecordIds({ search, languageConfig: 'jiebacfg' })).resolves.toEqual(
        expectedIds(expectedJieba)
      );
      await expect(findMatchingRecordIds({ search, languageConfig: 'jiebaqry' })).resolves.toEqual(
        expectedIds(expectedJieba)
      );
    }
  );

  const findMatchingRecordIds = async ({
    search,
    languageConfig,
  }: {
    search: string;
    languageConfig?: 'simple' | 'jiebacfg' | 'jiebaqry';
  }): Promise<string[]> => {
    const searchAccessPath: IRecordSearchAccessPath | undefined = languageConfig
      ? {
          kind: 'generated_tsvector',
          generatedColumnName: `__tqops_search_vector_${languageConfig}`,
          languageConfig,
          searchScope: 'selected_fields',
          coveredFieldIds: [fieldId],
        }
      : undefined;
    const whereClause = buildRecordSearchWhereClause(
      table,
      {
        search: RecordSearch.fromTuple([search, fieldId.toString(), true]),
      },
      {
        tableAlias: 't',
        searchAccessPath,
      }
    )._unsafeUnwrap();

    let query = db
      .selectFrom(`${fullTableName} as t`)
      .select('t.__id as id')
      .orderBy('t.__auto_number');
    if (whereClause != null) {
      query = query.where(whereClause);
    }
    const rows = await query.execute();
    return rows.map((row) => row.id as string);
  };
});
