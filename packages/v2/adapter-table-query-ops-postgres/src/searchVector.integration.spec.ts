/* eslint-disable @typescript-eslint/naming-convention */
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  BaseId,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  Table,
  TableId,
  TableName,
  ViewName,
} from '@teable/v2-core';
import { TableQueryObservationWindow, TableQueryShape } from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makePhysicalTableSql, quoteIdentifier } from './helpers';
import { ensureTableQueryOpsSchema, type TableQueryOpsDatabase } from './schema';
import {
  PostgresTableSearchVectorAdvisor,
  PostgresTableSearchVectorExecutor,
  PostgresTableSearchVectorReconciler,
} from './searchVector';
import type { UnknownPostgresDatabase } from './types';

const testDatabaseUrl = process.env.PRISMA_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('PostgresTableSearchVectorAdvisor', () => {
  let db: Kysely<UnknownPostgresDatabase>;

  beforeAll(async () => {
    db = await createV2PostgresDb<UnknownPostgresDatabase>({
      pg: {
        connectionString: testDatabaseUrl!,
        pool: {
          max: 1,
          allowExitOnIdle: true,
        },
      },
    });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('recommends a generated tsvector access path and validates the real GIN index after execution', async () => {
    const schemaName = `tqops_search_vector_${process.pid}_${Date.now()}`;
    const physicalTableName = 'records';
    const physicalTableSql = makePhysicalTableSql(schemaName, physicalTableName);
    const tableId = createTestId('tbl');
    const table = createSearchVectorTableAggregate({
      baseId: schemaName,
      tableId,
      physicalTableName,
    });

    await createSearchVectorFixture({ db, schemaName, physicalTableName, rowCount: 30_000 });

    try {
      const advisor = new PostgresTableSearchVectorAdvisor(db);
      const titleFieldId = 'fldTqOpsSearchTitle';
      const observedShape = TableQueryShape.create({
        queryKind: 'search',
        searchShape: {
          fieldCount: 1,
          allFields: false,
          searchedFieldIds: [titleFieldId],
          searchMode: 'full_text',
          searchScope: 'selected_fields',
          languageConfig: 'simple',
          valueLengthBucket: 'medium',
        },
        executionShape: {
          durationMs: 500,
          timedOut: false,
          resultCountBucket: 'small',
        },
      })._unsafeUnwrap();
      const observation = TableQueryObservationWindow.create({
        baseId: table.baseId().toString(),
        tableId: table.id().toString(),
        windowStart: new Date('2026-07-14T00:00:00.000Z'),
        windowSizeSeconds: 300,
        shape: observedShape,
        requestCount: 120,
        slowCount: 25,
        timeoutCount: 0,
        dbErrorCount: 0,
        totalDurationMs: 60_000,
        maxDurationMs: 3_500,
      })._unsafeUnwrap();
      const result = await advisor.analyze({} as never, {
        table,
        languageConfig: 'simple',
        searchProbe: 'needle package',
        observations: [observation],
      });
      const recommendation = result.recommendations[0];
      if (!recommendation) {
        throw new Error('Expected generated tsvector recommendation');
      }

      expect({
        accessPath: recommendation.accessPath,
        indexKind: recommendation.indexKind,
        languageConfig: recommendation.languageConfig,
        coveredFieldDbNames: recommendation.coveredFields.map((field) => field.fieldDbName),
        skippedReasons: recommendation.skippedFields.map((field) => field.skippedReason),
        planStatus: recommendation.planEvidence.explainStatus,
      }).toMatchInlineSnapshot(`
          {
            "accessPath": "generated_tsvector",
            "coveredFieldDbNames": [
              "fld_title",
              "fld_notes",
            ],
            "indexKind": "gin_tsvector",
            "languageConfig": "simple",
            "planStatus": "validated",
            "skippedReasons": [
              "non_text_value",
            ],
          }
        `);
      expect([
        'ready_for_confirmation',
        'needs_plan_validation',
        'candidate_not_recommended',
      ]).toContain(recommendation.nextAction);
      expect(recommendation.planEvidence.sqlDetails).toMatchObject({
        placeholders: {
          likePattern: ':search_probe_like_pattern',
          tsquery: ':search_probe',
        },
        redaction: 'search_probe_parameterized',
      });
      expect(recommendation.planEvidence.sqlDetails?.beforeSql).toContain('ILIKE');
      expect(recommendation.planEvidence.sqlDetails?.afterSql).toContain('websearch_to_tsquery');
      expect(JSON.stringify(recommendation.planEvidence.sqlDetails)).not.toContain(
        'needle package'
      );
      expect(result.scopeHeatReport).toMatchObject({
        tableId: table.id().toString(),
        scannedObservationCount: 1,
        scopes: [
          {
            searchedFieldIds: [titleFieldId],
            requestCount: 120,
            hot: true,
          },
        ],
      });
      expect(result.scopedExpressionRecommendations[0]).toMatchObject({
        indexKind: 'gin_tsvector_expression',
        accessPath: 'scoped_expression_gin',
        searchedFieldIds: [titleFieldId],
        coveredFields: [{ fieldId: titleFieldId, fieldDbName: 'fld_title' }],
        planEvidence: {
          explainStatus: 'skipped',
          explainReason: 'global_search_vector_not_ready',
        },
      });

      await ensureExecutorMeta({
        db,
        tableId: table.id().toString(),
        baseId: schemaName,
        dbTableName: `${schemaName}.${physicalTableName}`,
      });
      await ensureTableQueryOpsSchema(db as unknown as Kysely<TableQueryOpsDatabase>);

      const executor = new PostgresTableSearchVectorExecutor(db, db);
      const execution = await executor.execute({
        tableId: table.id().toString(),
        payload: {
          candidateKey: recommendation.candidateKey,
          languageConfig: recommendation.languageConfig,
          searchProbe: 'needle package',
          validationMode: 'real_ddl',
          generatedColumnName: recommendation.generatedColumnName,
          indexName: recommendation.indexName,
          fields: recommendation.coveredFields.map((field) => ({
            fieldId: field.fieldId,
            fieldDbName: field.fieldDbName ?? '',
            fieldType: field.fieldType,
          })),
          allowLargeTableRewrite: true,
        },
      });

      expect(execution.inventory.state).toBe('ready');
      expect(execution.action).toBe('created');
      expect(execution.planEvidence).toMatchObject({
        explainStatus: 'validated',
        explainMethod: 'real_index',
        usesCandidateIndex: true,
      });
      expect(execution.planEvidence?.costAfter).toBeLessThan(
        execution.planEvidence?.costBefore ?? 0
      );
      expect(execution.planEvidence?.sqlDetails?.afterSql).toContain(
        recommendation.generatedColumnName
      );
      expect(JSON.stringify(execution.planEvidence?.sqlDetails)).not.toContain('needle package');
      const scopedResult = await advisor.analyze({} as never, {
        table,
        languageConfig: 'simple',
        searchProbe: 'needle package',
        observations: [observation],
      });
      const scopedRecommendation = scopedResult.scopedExpressionRecommendations[0];
      expect(scopedRecommendation?.planEvidence.sqlDetails).toMatchObject({
        redaction: 'search_probe_parameterized',
      });
      expect(scopedRecommendation?.planEvidence.sqlDetails?.beforeSql).toContain(
        recommendation.generatedColumnName
      );
      expect(scopedRecommendation?.planEvidence.sqlDetails?.beforeSql).toContain('to_tsvector');
      expect(scopedRecommendation?.planEvidence.sqlDetails?.afterSql).toBe(
        scopedRecommendation?.planEvidence.sqlDetails?.beforeSql
      );
      expect(JSON.stringify(scopedRecommendation?.planEvidence.sqlDetails)).not.toContain(
        'needle package'
      );
      const persistedConfig = await sql<{
        space_id: string | null;
        base_id: string;
        table_id: string;
        status: string;
      }>`
        SELECT space_id, base_id, table_id, status
        FROM table_query_search_vector_config
        WHERE table_id = ${table.id().toString()}
          AND candidate_key = ${recommendation.candidateKey}
        LIMIT 1
      `.execute(db);
      expect(persistedConfig.rows[0]).toEqual({
        space_id: createMetaSpaceId(schemaName),
        base_id: schemaName,
        table_id: table.id().toString(),
        status: 'ready',
      });

      const reconciler = new PostgresTableSearchVectorReconciler(db, db);
      const repeatedCreate = await reconciler.reconcile({} as never, {
        table,
        mode: 'create',
        languageConfig: 'simple',
        searchProbe: 'needle package',
        validationMode: 'real_ddl',
      });
      expect(repeatedCreate._unsafeUnwrap().action).toBe('verified');

      const rebuilt = await reconciler.reconcile({} as never, {
        table,
        mode: 'rebuild',
        languageConfig: 'simple',
        searchProbe: 'needle package',
        validationMode: 'real_ddl',
        allowLargeTableRewrite: true,
      });
      expect(rebuilt._unsafeUnwrap().action).toBe('rebuilt');

      await sql
        .raw(
          `UPDATE ${physicalTableSql} SET ${quoteIdentifier(
            'fld_title'
          )} = 'fresh generated search token' WHERE "__id" = 'rec_1'`
        )
        .execute(db);
      const generatedCount = await sql<{ count: string | number }>`
          SELECT count(*) AS count
          FROM ${sql.raw(physicalTableSql)}
          WHERE ${sql.raw(quoteIdentifier(recommendation.generatedColumnName))} @@ websearch_to_tsquery('simple'::regconfig, 'fresh generated search token')
        `.execute(db);

      expect(Number(generatedCount.rows[0]?.count ?? 0)).toBeGreaterThan(0);
    } finally {
      await cleanupExecutorMeta({
        db,
        tableId,
        baseId: schemaName,
      });
      await sql.raw(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`).execute(db);
    }
  }, 60_000);
});

const createTestId = (prefix: string): string => {
  const seed = `${process.pid}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}${seed
    .replace(/[^0-9a-z]/gi, '')
    .padEnd(16, '0')
    .slice(0, 16)}`;
};

const ensureExecutorMeta = async (input: {
  readonly db: Kysely<UnknownPostgresDatabase>;
  readonly tableId: string;
  readonly baseId: string;
  readonly dbTableName: string;
}): Promise<void> => {
  const spaceId = createMetaSpaceId(input.baseId);
  await sql`
    CREATE TABLE IF NOT EXISTS space (
      id text PRIMARY KEY,
      name text NOT NULL,
      credit integer,
      deleted_time timestamp with time zone,
      created_by text NOT NULL DEFAULT 'test',
      created_time timestamp with time zone NOT NULL DEFAULT now(),
      last_modified_by text,
      last_modified_time timestamp with time zone,
      is_template boolean
    )
  `.execute(input.db);
  await sql`
    CREATE TABLE IF NOT EXISTS base (
      id text PRIMARY KEY,
      space_id text NOT NULL REFERENCES space(id),
      name text NOT NULL,
      "order" double precision NOT NULL DEFAULT 0,
      icon text,
      schema_pass text,
      provision_state text NOT NULL DEFAULT 'ready',
      deleted_time timestamp with time zone,
      created_by text NOT NULL DEFAULT 'test',
      created_time timestamp with time zone NOT NULL DEFAULT now(),
      last_modified_by text,
      last_modified_time timestamp with time zone
    )
  `.execute(input.db);
  await sql`
    CREATE TABLE IF NOT EXISTS table_meta (
      id text PRIMARY KEY,
      base_id text NOT NULL,
      name text NOT NULL DEFAULT 'Search Vector Test',
      description text,
      icon text,
      db_table_name text NOT NULL,
      db_view_name text,
      provision_state text NOT NULL DEFAULT 'ready',
      version integer NOT NULL DEFAULT 1,
      "order" double precision NOT NULL DEFAULT 0,
      created_time timestamp with time zone NOT NULL DEFAULT now(),
      last_modified_time timestamp with time zone,
      deleted_time timestamp with time zone,
      created_by text NOT NULL DEFAULT 'test',
      last_modified_by text
    )
  `.execute(input.db);
  await sql`
    INSERT INTO space (id, name, created_by)
    VALUES (${spaceId}, 'Search Vector Test Space', 'test')
    ON CONFLICT (id)
    DO UPDATE SET name = EXCLUDED.name
  `.execute(input.db);
  await sql`
    INSERT INTO base (id, space_id, name, "order", created_by)
    VALUES (${input.baseId}, ${spaceId}, 'Search Vector Test Base', 0, 'test')
    ON CONFLICT (id)
    DO UPDATE SET
      space_id = EXCLUDED.space_id,
      name = EXCLUDED.name
  `.execute(input.db);
  await sql`
    INSERT INTO table_meta (id, base_id, name, db_table_name, version, "order", created_by)
    VALUES (${input.tableId}, ${input.baseId}, 'Search Vector Test', ${input.dbTableName}, 1, 0, 'test')
    ON CONFLICT (id)
    DO UPDATE SET
      base_id = EXCLUDED.base_id,
      db_table_name = EXCLUDED.db_table_name
  `.execute(input.db);
};

const cleanupExecutorMeta = async (input: {
  readonly db: Kysely<UnknownPostgresDatabase>;
  readonly tableId: string;
  readonly baseId: string;
}): Promise<void> => {
  if (await relationExists(input.db, 'table_query_search_vector_config')) {
    await sql`DELETE FROM table_query_search_vector_config WHERE table_id = ${input.tableId}`.execute(
      input.db
    );
  }
  if (await relationExists(input.db, 'table_meta')) {
    await sql`DELETE FROM table_meta WHERE id = ${input.tableId}`.execute(input.db);
  }
  if (await relationExists(input.db, 'base')) {
    await sql`DELETE FROM base WHERE id = ${input.baseId}`.execute(input.db);
  }
  if (await relationExists(input.db, 'space')) {
    await sql`DELETE FROM space WHERE id = ${createMetaSpaceId(input.baseId)}`.execute(input.db);
  }
};

const createMetaSpaceId = (baseId: string): string => `spc_${baseId}`;

const relationExists = async (
  db: Kysely<UnknownPostgresDatabase>,
  relationName: string
): Promise<boolean> => {
  const result = await sql<{ exists: boolean }>`
    SELECT to_regclass(${relationName}) IS NOT NULL AS exists
  `.execute(db);
  return Boolean(result.rows[0]?.exists);
};

const createSearchVectorFixture = async (input: {
  readonly db: Kysely<UnknownPostgresDatabase>;
  readonly schemaName: string;
  readonly physicalTableName: string;
  readonly rowCount: number;
}): Promise<void> => {
  const physicalTableSql = makePhysicalTableSql(input.schemaName, input.physicalTableName);
  await sql.raw(`CREATE SCHEMA ${quoteIdentifier(input.schemaName)}`).execute(input.db);
  await sql
    .raw(
      `CREATE TABLE ${physicalTableSql} (
        "__id" text PRIMARY KEY,
        ${quoteIdentifier('fld_title')} text,
        ${quoteIdentifier('fld_notes')} text,
        ${quoteIdentifier('fld_count')} integer
      )`
    )
    .execute(input.db);
  await sql
    .raw(
      `INSERT INTO ${physicalTableSql} ("__id", ${quoteIdentifier('fld_title')}, ${quoteIdentifier(
        'fld_notes'
      )}, ${quoteIdentifier('fld_count')})
       SELECT 'rec_' || i::text,
              CASE WHEN i = 4242 THEN 'needle package target'
                   ELSE md5(i::text) || md5((i + 100000)::text)
              END,
              CASE WHEN i = 4242 THEN 'shipment note target'
                   ELSE md5((i + 200000)::text)
              END,
              i
       FROM generate_series(1, ${input.rowCount}) AS i`
    )
    .execute(input.db);
  await sql.raw(`ANALYZE ${physicalTableSql}`).execute(input.db);
};

const createSearchVectorTableAggregate = (input: {
  readonly baseId: string;
  readonly tableId: string;
  readonly physicalTableName: string;
}): Table => {
  const builder = Table.builder()
    .withId(TableId.create(input.tableId)._unsafeUnwrap())
    .withBaseId(BaseId.create(input.baseId)._unsafeUnwrap())
    .withName(TableName.create('Query Ops Search Vector')._unsafeUnwrap())
    .withDbTableName(
      DbTableName.rehydrate(`${input.baseId}.${input.physicalTableName}`)._unsafeUnwrap()
    );

  builder
    .field()
    .singleLineText()
    .withId(FieldId.create('fldTqOpsSearchTitle')._unsafeUnwrap())
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .longText()
    .withId(FieldId.create('fldTqOpsSearchNotes')._unsafeUnwrap())
    .withName(FieldName.create('Notes')._unsafeUnwrap())
    .done();
  builder
    .field()
    .number()
    .withId(FieldId.create('fldTqOpsSearchCount')._unsafeUnwrap())
    .withName(FieldName.create('Count')._unsafeUnwrap())
    .done();
  builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();

  const table = builder.build()._unsafeUnwrap();
  const [titleField, notesField, countField] = table.getFields();
  titleField?.setDbFieldName(DbFieldName.rehydrate('fld_title')._unsafeUnwrap())._unsafeUnwrap();
  notesField?.setDbFieldName(DbFieldName.rehydrate('fld_notes')._unsafeUnwrap())._unsafeUnwrap();
  countField?.setDbFieldName(DbFieldName.rehydrate('fld_count')._unsafeUnwrap())._unsafeUnwrap();
  return table;
};
