/* eslint-disable @typescript-eslint/naming-convention */
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  BaseId,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  SelectOption,
  Table,
  TableId,
  TableName,
  ViewName,
} from '@teable/v2-core';
import {
  TableQueryObservationWindow,
  TableQueryRecommendation,
  TableQueryRiskPolicy,
  TableQueryShape,
  type TableQueryShapeInput,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Result } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makePhysicalTableSql, quoteIdentifier } from './helpers';
import { PostgresTableQueryIndexInspector } from './indexInspection';
import { PostgresTableQueryPlanValidator } from './planValidation';
import { PostgresTablePhysicalStatsReader } from './repositories';
import type { UnknownPostgresDatabase } from './types';

type ExplainNode = {
  readonly 'Node Type'?: string;
  readonly 'Index Name'?: string;
  readonly 'Total Cost'?: number;
  readonly Plans?: ReadonlyArray<ExplainNode>;
};

type ExplainOutput = {
  readonly Plan: ExplainNode;
  readonly 'Execution Time'?: number;
};

const unwrapTestResult = <T>(label: string, result: Result<T, { readonly message: string }>): T => {
  if (result.isErr()) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.value;
};

const testDatabaseUrl = process.env.PRISMA_DATABASE_URL;

const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

type AdvisorIntegrationCase = {
  readonly name: string;
  readonly tableId: string;
  readonly fieldId: string;
  readonly fieldDbName: string;
  readonly fieldSqlType: string;
  readonly aggregateFieldType: 'singleLineText' | 'singleSelect' | 'number';
  readonly valueExpressionSql: string;
  readonly normalizedSql: (input: { physicalTableSql: string; fieldSql: string }) => string;
  readonly shape: (fieldId: string) => TableQueryShapeInput;
  readonly indexMethod: 'btree' | 'gin';
  readonly indexColumnOpclass?: string;
  readonly expectedIndexKind: 'btree' | 'gin_trgm';
  readonly expectedRemediationKind:
    | 'create_filter_index'
    | 'create_search_index'
    | 'create_sort_index';
  readonly requiresPgTrgm?: boolean;
  readonly rowCount: number;
};

const cases = [
  {
    name: 'text contains filter recommends and benefits from a trigram index',
    tableId: 'tblTqOpsText0000001',
    fieldId: 'fldTqOpsText0000001',
    fieldDbName: 'fld_text',
    fieldSqlType: 'text',
    aggregateFieldType: 'singleLineText',
    valueExpressionSql: `
      CASE WHEN i = 4242 THEN 'needle xxx target'
           ELSE md5(i::text) || md5((i + 100000)::text)
      END
    `,
    normalizedSql: ({ physicalTableSql, fieldSql }) =>
      `SELECT "__id" FROM ${physicalTableSql} WHERE ${fieldSql} ILIKE '%xxx%'`,
    shape: (fieldId) => ({
      queryKind: 'filter',
      whereShape: {
        conditionCount: 1,
        andDepth: 1,
        orDepth: 0,
        fields: [
          {
            fieldId,
            fieldType: 'singleLineText',
            operatorFamily: 'text_contains',
          },
        ],
      },
      executionShape: {
        durationMs: 12_000,
        dbDurationMs: 11_500,
        timedOut: false,
        resultCountBucket: 'small',
      },
    }),
    indexMethod: 'gin',
    indexColumnOpclass: 'gin_trgm_ops',
    expectedIndexKind: 'gin_trgm',
    expectedRemediationKind: 'create_search_index',
    requiresPgTrgm: true,
    rowCount: 50_000,
  },
  {
    name: 'equality filter recommends and benefits from a btree index',
    tableId: 'tblTqOpsEq000000001',
    fieldId: 'fldTqOpsEq000000001',
    fieldDbName: 'fld_status',
    fieldSqlType: 'text',
    aggregateFieldType: 'singleSelect',
    valueExpressionSql: `
      CASE WHEN i = 4242 THEN 'target_status'
           ELSE 'status_' || i::text
      END
    `,
    normalizedSql: ({ physicalTableSql, fieldSql }) =>
      `SELECT "__id" FROM ${physicalTableSql} WHERE ${fieldSql} = 'target_status'`,
    shape: (fieldId) => ({
      queryKind: 'filter',
      whereShape: {
        conditionCount: 1,
        andDepth: 1,
        orDepth: 0,
        fields: [{ fieldId, fieldType: 'singleSelect', operatorFamily: 'equality' }],
      },
      executionShape: {
        durationMs: 12_000,
        dbDurationMs: 11_500,
        timedOut: false,
        resultCountBucket: 'small',
      },
    }),
    indexMethod: 'btree',
    expectedIndexKind: 'btree',
    expectedRemediationKind: 'create_filter_index',
    rowCount: 50_000,
  },
  {
    name: 'range filter recommends and benefits from a btree index',
    tableId: 'tblTqOpsRange000001',
    fieldId: 'fldTqOpsRange000001',
    fieldDbName: 'fld_score',
    fieldSqlType: 'integer',
    aggregateFieldType: 'number',
    valueExpressionSql: 'i',
    normalizedSql: ({ physicalTableSql, fieldSql }) =>
      `SELECT "__id" FROM ${physicalTableSql} WHERE ${fieldSql} BETWEEN 4242 AND 4252`,
    shape: (fieldId) => ({
      queryKind: 'filter',
      whereShape: {
        conditionCount: 1,
        andDepth: 1,
        orDepth: 0,
        fields: [{ fieldId, fieldType: 'number', operatorFamily: 'range' }],
      },
      executionShape: {
        durationMs: 12_000,
        dbDurationMs: 11_500,
        timedOut: false,
        resultCountBucket: 'small',
      },
    }),
    indexMethod: 'btree',
    expectedIndexKind: 'btree',
    expectedRemediationKind: 'create_filter_index',
    rowCount: 50_000,
  },
  {
    name: 'sort query recommends and benefits from a btree index',
    tableId: 'tblTqOpsSort0000001',
    fieldId: 'fldTqOpsSort0000001',
    fieldDbName: 'fld_rank',
    fieldSqlType: 'integer',
    aggregateFieldType: 'number',
    valueExpressionSql: '50000 - i',
    normalizedSql: ({ physicalTableSql, fieldSql }) =>
      `SELECT "__id" FROM ${physicalTableSql} ORDER BY ${fieldSql} DESC LIMIT 25`,
    shape: (fieldId) => ({
      queryKind: 'sort',
      orderShape: {
        fields: [{ fieldId, direction: 'desc', source: 'sort' }],
      },
      executionShape: {
        durationMs: 12_000,
        dbDurationMs: 11_500,
        timedOut: false,
        resultCountBucket: 'small',
      },
    }),
    indexMethod: 'btree',
    expectedIndexKind: 'btree',
    expectedRemediationKind: 'create_sort_index',
    rowCount: 50_000,
  },
] satisfies ReadonlyArray<AdvisorIntegrationCase>;

describeWithPostgres('Table Query Ops advisor integration', () => {
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

  it.each(cases)(
    '$name',
    async (testCase) => {
      const schemaName = `tqops_e2e_${process.pid}_${Date.now()}`;
      const physicalTableName = 'records';
      const physicalTableSql = makePhysicalTableSql(schemaName, physicalTableName);
      const fieldSql = quoteIdentifier(testCase.fieldDbName);
      const normalizedSql = testCase.normalizedSql({ physicalTableSql, fieldSql });
      const indexName = `idx_${schemaName}_${testCase.fieldDbName}_${testCase.expectedIndexKind}`;

      await createSingleFieldFixture({
        db,
        schemaName,
        physicalTableName,
        fieldDbName: testCase.fieldDbName,
        fieldSqlType: testCase.fieldSqlType,
        rowCount: testCase.rowCount,
        valueExpressionSql: testCase.valueExpressionSql,
        requiresPgTrgm: testCase.requiresPgTrgm,
      });

      try {
        const table = createTableAggregate({
          baseId: schemaName,
          tableId: testCase.tableId,
          fieldId: testCase.fieldId,
          fieldDbName: testCase.fieldDbName,
          aggregateFieldType: testCase.aggregateFieldType,
          physicalTableName,
        });
        const shape = TableQueryShape.create(testCase.shape(testCase.fieldId))._unsafeUnwrap();
        const observation = TableQueryObservationWindow.create({
          baseId: schemaName,
          tableId: testCase.tableId,
          windowStart: new Date('2026-06-01T00:00:00.000Z'),
          windowSizeSeconds: 300,
          shape,
          requestCount: 6,
          slowCount: 6,
          timeoutCount: 0,
          dbErrorCount: 0,
          totalDurationMs: 72_000,
          maxDurationMs: 12_000,
          totalDbDurationMs: 69_000,
          maxDbDurationMs: 11_500,
          sqlDiagnostics: [
            {
              source: 'integration-test',
              statementKind: 'select',
              fingerprint: 'text-contains-single-field',
              parameterCount: 0,
              sampled: true,
              normalizedSql,
            },
          ],
        })._unsafeUnwrap();

        const indexInspector = new PostgresTableQueryIndexInspector(db);
        const statsReader = new PostgresTablePhysicalStatsReader(db);
        const planValidator = new PostgresTableQueryPlanValidator(db);

        const beforeExplain = await explainAnalyze(db, normalizedSql);
        const beforeInspection = (
          await indexInspector.inspect({} as never, table, shape)
        )._unsafeUnwrap();
        const physicalStats = (await statsReader.read({} as never, table))._unsafeUnwrap();
        const planValidation = (
          await planValidator.validate({} as never, {
            table,
            observation,
            indexInspection: beforeInspection,
          })
        )._unsafeUnwrap();
        const report = new TableQueryRiskPolicy()
          .evaluate({
            observation,
            physicalStats,
            indexInspection: beforeInspection,
            planValidation,
          })
          ._unsafeUnwrap();
        const recommendation = TableQueryRecommendation.createOpen({
          observation,
          report,
          now: new Date('2026-06-01T00:05:00.000Z'),
        })._unsafeUnwrap();

        expect({
          shape: shape.snapshot(),
          indexInspection: beforeInspection.snapshot(),
          recommendation: normalizeRecommendationSnapshot(recommendation.snapshot()),
          planEvidence: normalizePlanEvidence(planValidation.snapshot()),
        }).toMatchSnapshot(testCase.name);
        expect(report.shouldRecommend()).toBe(true);
        expect(recommendation.snapshot().remediationCandidates[0]).toMatchObject({
          kind: testCase.expectedRemediationKind,
          indexKind: testCase.expectedIndexKind,
          fieldDbName: testCase.fieldDbName,
        });

        if (planValidation.snapshot().method === 'hypothetical_index') {
          expect(planValidation.supportsAutoExecution()).toBe(true);
        }

        if (testCase.requiresPgTrgm) {
          await sql.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm').execute(db);
        }
        await sql
          .raw(
            `CREATE INDEX ${quoteIdentifier(indexName)} ON ${physicalTableSql} USING ${
              testCase.indexMethod
            } (${fieldSql}${testCase.indexColumnOpclass ? ` ${testCase.indexColumnOpclass}` : ''})`
          )
          .execute(db);
        await sql.raw(`ANALYZE ${physicalTableSql}`).execute(db);

        const afterInspection = (
          await indexInspector.inspect({} as never, table, shape)
        )._unsafeUnwrap();
        const afterExplain = await explainAnalyze(db, normalizedSql);

        expect(afterInspection.snapshot()).toMatchObject({
          state: 'ready',
          missingIndexCandidates: [],
          usefulIndexes: [
            {
              fieldId: testCase.fieldId,
              fieldDbName: testCase.fieldDbName,
              kind: testCase.expectedIndexKind,
              valid: true,
            },
          ],
        });
        expect(afterExplain.indexNames).toContain(indexName);
        expect(afterExplain.totalCost).toBeLessThan(beforeExplain.totalCost);
        expect(afterExplain.executionTimeMs).toBeLessThan(beforeExplain.executionTimeMs);
      } finally {
        await sql.raw(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`).execute(db);
      }
    },
    60_000
  );

  it('filter plus sort recommends and benefits from one composite btree index', async () => {
    const schemaName = `tqops_e2e_composite_${process.pid}_${Date.now()}`;
    const physicalTableName = 'records';
    const physicalTableSql = makePhysicalTableSql(schemaName, physicalTableName);
    const statusFieldId = 'fldTqOpsStatus00001';
    const rankFieldId = 'fldTqOpsRank0000001';
    const statusFieldDbName = 'fld_status';
    const rankFieldDbName = 'fld_rank';
    const statusFieldSql = quoteIdentifier(statusFieldDbName);
    const rankFieldSql = quoteIdentifier(rankFieldDbName);
    const normalizedSql = `SELECT "__id" FROM ${physicalTableSql} WHERE ${statusFieldSql} = 'target_status' ORDER BY ${rankFieldSql} DESC LIMIT 25`;
    const indexName = `idx_${schemaName}_status_rank_btree`;

    await createCompositeFixture({
      db,
      schemaName,
      physicalTableName,
      rowCount: 50_000,
      statusFieldDbName,
      rankFieldDbName,
    });

    try {
      const table = createCompositeTableAggregate({
        baseId: schemaName,
        tableId: 'tblTqOpsComposite01',
        statusFieldId,
        rankFieldId,
        statusFieldDbName,
        rankFieldDbName,
        physicalTableName,
      });
      const shape = unwrapTestResult(
        'create composite shape',
        TableQueryShape.create({
          queryKind: 'filter',
          whereShape: {
            conditionCount: 1,
            andDepth: 1,
            orDepth: 0,
            fields: [
              {
                fieldId: statusFieldId,
                fieldType: 'singleSelect',
                operatorFamily: 'equality',
              },
            ],
          },
          orderShape: {
            fields: [{ fieldId: rankFieldId, direction: 'desc', source: 'sort' }],
          },
          executionShape: {
            durationMs: 12_000,
            dbDurationMs: 11_500,
            timedOut: false,
            resultCountBucket: 'small',
          },
        })
      );
      const observation = unwrapTestResult(
        'create composite observation',
        TableQueryObservationWindow.create({
          baseId: schemaName,
          tableId: 'tblTqOpsComposite01',
          windowStart: new Date('2026-06-01T00:00:00.000Z'),
          windowSizeSeconds: 300,
          shape,
          requestCount: 6,
          slowCount: 6,
          timeoutCount: 0,
          dbErrorCount: 0,
          totalDurationMs: 72_000,
          maxDurationMs: 12_000,
          totalDbDurationMs: 69_000,
          maxDbDurationMs: 11_500,
          sqlDiagnostics: [
            {
              source: 'integration-test',
              statementKind: 'select',
              fingerprint: 'filter-sort-composite',
              parameterCount: 0,
              sampled: true,
              normalizedSql,
            },
          ],
        })
      );
      const indexInspector = new PostgresTableQueryIndexInspector(db);
      const statsReader = new PostgresTablePhysicalStatsReader(db);
      const planValidator = new PostgresTableQueryPlanValidator(db);

      const beforeExplain = await explainAnalyze(db, normalizedSql);
      const beforeInspection = unwrapTestResult(
        'inspect composite indexes before',
        await indexInspector.inspect({} as never, table, shape)
      );
      const physicalStats = unwrapTestResult(
        'read composite physical stats',
        await statsReader.read({} as never, table)
      );
      const planValidation = unwrapTestResult(
        'validate composite plan',
        await planValidator.validate({} as never, {
          table,
          observation,
          indexInspection: beforeInspection,
        })
      );
      const report = unwrapTestResult(
        'evaluate composite risk',
        new TableQueryRiskPolicy().evaluate({
          observation,
          physicalStats,
          indexInspection: beforeInspection,
          planValidation,
        })
      );

      expect({
        shape: shape.snapshot(),
        indexInspection: beforeInspection.snapshot(),
        remediationCandidates: report.snapshot().remediationCandidates,
        planEvidence: normalizePlanEvidence(planValidation.snapshot()),
      }).toMatchSnapshot();
      expect(beforeInspection.snapshot().missingIndexCandidates).toMatchObject([
        {
          kind: 'btree',
          accessPath: 'composite',
          fields: [
            { fieldId: statusFieldId, fieldDbName: statusFieldDbName, role: 'filter' },
            {
              fieldId: rankFieldId,
              fieldDbName: rankFieldDbName,
              direction: 'desc',
              role: 'sort',
            },
          ],
        },
      ]);
      expect(report.snapshot().remediationCandidates[0]).toMatchObject({
        kind: 'create_filter_index',
        indexKind: 'btree',
        accessPath: 'composite',
      });

      await sql
        .raw(
          `CREATE INDEX ${quoteIdentifier(indexName)} ON ${physicalTableSql} USING btree (${statusFieldSql}, ${rankFieldSql} DESC)`
        )
        .execute(db);
      await sql.raw(`ANALYZE ${physicalTableSql}`).execute(db);

      const afterInspection = unwrapTestResult(
        'inspect composite indexes after',
        await indexInspector.inspect({} as never, table, shape)
      );
      const afterExplain = await explainAnalyze(db, normalizedSql);

      expect(afterInspection.snapshot()).toMatchObject({
        state: 'ready',
        missingIndexCandidates: [],
        usefulIndexes: [
          {
            kind: 'btree',
            accessPath: 'composite',
            fields: [
              { fieldId: statusFieldId, fieldDbName: statusFieldDbName, role: 'filter' },
              {
                fieldId: rankFieldId,
                fieldDbName: rankFieldDbName,
                direction: 'desc',
                role: 'sort',
              },
            ],
          },
        ],
      });
      expect(afterExplain.indexNames).toContain(indexName);
      expect(afterExplain.totalCost).toBeLessThan(beforeExplain.totalCost);
    } finally {
      await sql.raw(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`).execute(db);
    }
  }, 60_000);
});

const createSingleFieldFixture = async (input: {
  readonly db: Kysely<UnknownPostgresDatabase>;
  readonly schemaName: string;
  readonly physicalTableName: string;
  readonly fieldDbName: string;
  readonly fieldSqlType: string;
  readonly rowCount: number;
  readonly valueExpressionSql: string;
  readonly requiresPgTrgm?: boolean;
}): Promise<void> => {
  const physicalTableSql = makePhysicalTableSql(input.schemaName, input.physicalTableName);
  if (input.requiresPgTrgm) {
    await sql.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm').execute(input.db);
  }
  await sql
    .raw(`DROP SCHEMA IF EXISTS ${quoteIdentifier(input.schemaName)} CASCADE`)
    .execute(input.db);
  await sql.raw(`CREATE SCHEMA ${quoteIdentifier(input.schemaName)}`).execute(input.db);
  await sql
    .raw(
      `CREATE TABLE ${physicalTableSql} ("__id" text PRIMARY KEY, ${quoteIdentifier(
        input.fieldDbName
      )} ${input.fieldSqlType} NOT NULL)`
    )
    .execute(input.db);
  await sql
    .raw(
      `INSERT INTO ${physicalTableSql} ("__id", ${quoteIdentifier(input.fieldDbName)})
       SELECT 'rec_' || i::text,
              ${input.valueExpressionSql}
       FROM generate_series(1, ${input.rowCount}) AS i`
    )
    .execute(input.db);
  await sql.raw(`ANALYZE ${physicalTableSql}`).execute(input.db);
};

const createCompositeFixture = async (input: {
  readonly db: Kysely<UnknownPostgresDatabase>;
  readonly schemaName: string;
  readonly physicalTableName: string;
  readonly rowCount: number;
  readonly statusFieldDbName: string;
  readonly rankFieldDbName: string;
}): Promise<void> => {
  const physicalTableSql = makePhysicalTableSql(input.schemaName, input.physicalTableName);
  await sql
    .raw(`DROP SCHEMA IF EXISTS ${quoteIdentifier(input.schemaName)} CASCADE`)
    .execute(input.db);
  await sql.raw(`CREATE SCHEMA ${quoteIdentifier(input.schemaName)}`).execute(input.db);
  await sql
    .raw(
      `CREATE TABLE ${physicalTableSql} (
        "__id" text PRIMARY KEY,
        ${quoteIdentifier(input.statusFieldDbName)} text NOT NULL,
        ${quoteIdentifier(input.rankFieldDbName)} integer NOT NULL
      )`
    )
    .execute(input.db);
  await sql
    .raw(
      `INSERT INTO ${physicalTableSql} (
        "__id",
        ${quoteIdentifier(input.statusFieldDbName)},
        ${quoteIdentifier(input.rankFieldDbName)}
      )
       SELECT 'rec_' || i::text,
              CASE WHEN i % 20 = 0 THEN 'target_status' ELSE 'status_' || (i % 500)::text END,
              i
       FROM generate_series(1, ${input.rowCount}) AS i`
    )
    .execute(input.db);
  await sql.raw(`ANALYZE ${physicalTableSql}`).execute(input.db);
};

const createTableAggregate = (input: {
  readonly baseId: string;
  readonly tableId: string;
  readonly fieldId: string;
  readonly fieldDbName: string;
  readonly aggregateFieldType: 'singleLineText' | 'singleSelect' | 'number';
  readonly physicalTableName: string;
}): Table => {
  const builder = Table.builder()
    .withId(TableId.create(input.tableId)._unsafeUnwrap())
    .withBaseId(BaseId.create(input.baseId)._unsafeUnwrap())
    .withName(TableName.create('Query Ops Text Contains')._unsafeUnwrap())
    .withDbTableName(
      DbTableName.rehydrate(`${input.baseId}.${input.physicalTableName}`)._unsafeUnwrap()
    );
  const fieldBuilder = builder.field();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();
  const fieldId = FieldId.create(input.fieldId)._unsafeUnwrap();
  if (input.aggregateFieldType === 'singleSelect') {
    fieldBuilder
      .singleSelect()
      .withId(fieldId)
      .withName(fieldName)
      .withOptions([SelectOption.create({ name: 'target_status', color: 'blue' })._unsafeUnwrap()])
      .primary()
      .done();
  } else if (input.aggregateFieldType === 'number') {
    fieldBuilder.number().withId(fieldId).withName(fieldName).primary().done();
  } else {
    fieldBuilder.singleLineText().withId(fieldId).withName(fieldName).primary().done();
  }
  builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
  const table = builder.build()._unsafeUnwrap();
  table
    .getFields()[0]
    ?.setDbFieldName(DbFieldName.rehydrate(input.fieldDbName)._unsafeUnwrap())
    ._unsafeUnwrap();
  return table;
};

const createCompositeTableAggregate = (input: {
  readonly baseId: string;
  readonly tableId: string;
  readonly statusFieldId: string;
  readonly rankFieldId: string;
  readonly statusFieldDbName: string;
  readonly rankFieldDbName: string;
  readonly physicalTableName: string;
}): Table => {
  const builder = Table.builder()
    .withId(unwrapTestResult('create composite table id', TableId.create(input.tableId)))
    .withBaseId(unwrapTestResult('create composite base id', BaseId.create(input.baseId)))
    .withName(
      unwrapTestResult('create composite table name', TableName.create('Query Ops Composite'))
    )
    .withDbTableName(
      unwrapTestResult(
        'rehydrate composite db table name',
        DbTableName.rehydrate(`${input.baseId}.${input.physicalTableName}`)
      )
    );
  builder
    .field()
    .singleSelect()
    .withId(unwrapTestResult('create status field id', FieldId.create(input.statusFieldId)))
    .withName(unwrapTestResult('create status field name', FieldName.create('Status')))
    .withOptions([
      unwrapTestResult(
        'create status select option',
        SelectOption.create({ name: 'target_status', color: 'blue' })
      ),
    ])
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(unwrapTestResult('create rank field id', FieldId.create(input.rankFieldId)))
    .withName(unwrapTestResult('create rank field name', FieldName.create('Rank')))
    .done();
  builder
    .view()
    .grid()
    .withName(unwrapTestResult('create composite view name', ViewName.create('Grid')))
    .done();
  const table = unwrapTestResult('build composite table', builder.build());
  unwrapTestResult(
    'set status db field name',
    table
      .getFields()[0]!
      .setDbFieldName(
        unwrapTestResult(
          'rehydrate status db field name',
          DbFieldName.rehydrate(input.statusFieldDbName)
        )
      )
  );
  unwrapTestResult(
    'set rank db field name',
    table
      .getFields()[1]!
      .setDbFieldName(
        unwrapTestResult(
          'rehydrate rank db field name',
          DbFieldName.rehydrate(input.rankFieldDbName)
        )
      )
  );
  return table;
};

const explainAnalyze = async (
  db: Kysely<UnknownPostgresDatabase>,
  statement: string
): Promise<{
  readonly totalCost: number;
  readonly executionTimeMs: number;
  readonly nodeTypes: ReadonlyArray<string>;
  readonly indexNames: ReadonlyArray<string>;
}> => {
  const result = await sql<{ 'QUERY PLAN': unknown }>`
    EXPLAIN (ANALYZE, FORMAT JSON) ${sql.raw(statement)}
  `.execute(db);
  const plan = parseExplainOutput(result.rows[0]?.['QUERY PLAN']);
  return {
    totalCost: readNumber(plan.Plan['Total Cost']),
    executionTimeMs: readNumber(plan['Execution Time']),
    nodeTypes: flattenNodeTypes(plan.Plan),
    indexNames: flattenIndexNames(plan.Plan),
  };
};

const parseExplainOutput = (value: unknown): ExplainOutput => {
  const raw = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  const root = Array.isArray(raw) ? raw[0] : raw;
  if (!root || typeof root !== 'object' || !('Plan' in root)) {
    throw new Error('Missing EXPLAIN plan');
  }
  return root as ExplainOutput;
};

const flattenNodeTypes = (node: ExplainNode): ReadonlyArray<string> => [
  ...(node['Node Type'] ? [node['Node Type']] : []),
  ...(node.Plans?.flatMap(flattenNodeTypes) ?? []),
];

const flattenIndexNames = (node: ExplainNode): ReadonlyArray<string> => [
  ...(node['Index Name'] ? [node['Index Name']] : []),
  ...(node.Plans?.flatMap(flattenIndexNames) ?? []),
];

const readNumber = (value: unknown): number => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error('Expected numeric EXPLAIN value');
  }
  return numberValue;
};

const normalizeRecommendationSnapshot = (
  snapshot: ReturnType<TableQueryRecommendation['snapshot']>
) => ({
  status: snapshot.status,
  riskLevel: snapshot.riskLevel,
  riskScore: snapshot.riskScore,
  reasonCodes: snapshot.reasonCodes,
  remediationCandidates: snapshot.remediationCandidates,
});

const normalizePlanEvidence = (snapshot: {
  readonly status: string;
  readonly candidateCount: number;
  readonly totalCostBefore?: number;
}) => ({
  status: snapshot.status,
  candidateCount: snapshot.candidateCount,
  hasBaselineCost: typeof snapshot.totalCostBefore === 'number',
});
