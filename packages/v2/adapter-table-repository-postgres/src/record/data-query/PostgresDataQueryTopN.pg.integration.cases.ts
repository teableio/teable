import { ActorId, DefaultTableMapper, type ITablePersistenceDTO } from '@teable/v2-core';
import { DataQueryDefinition } from '@teable/v2-data-query';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { CompiledQuery, sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

const integrationEnabled = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1';

const baseId = `bse${'t'.repeat(16)}`;
const tableId = `tbl${'t'.repeat(16)}`;
const categoryId = `fld${'t'.repeat(16)}`;
const scoreId = `fld${'u'.repeat(16)}`;
const cohortId = `fld${'v'.repeat(16)}`;
const schema = `topn_${process.pid}`;
const physicalTable = 'ranked_records';
const relation = `${schema}.${physicalTable}`;
const context = { actorId: ActorId.create(`usr${'t'.repeat(16)}`)._unsafeUnwrap() };
const tableDto: ITablePersistenceDTO = {
  id: tableId,
  baseId,
  name: 'Top-N scale fixture',
  dbTableName: relation,
  primaryFieldId: categoryId,
  fields: [
    { id: categoryId, name: 'Category', type: 'singleLineText', dbFieldName: 'category' },
    { id: cohortId, name: 'Cohort', type: 'singleLineText', dbFieldName: 'cohort' },
    {
      id: scoreId,
      name: 'Score',
      type: 'number',
      dbFieldName: 'score',
      options: { formatting: { type: 'decimal', precision: 0 } },
    },
  ],
  views: [{ id: `viw${'t'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
};

type Db = Kysely<V1TeableDatabase>;

export const registerTopNPostgresCases = () =>
  describe.skipIf(!integrationEnabled)('PostgresDataQueryExecutor topN integration', () => {
    let container: StartedPostgreSqlContainer | undefined;
    let db: Db | undefined;
    let executor: PostgresDataQueryExecutor;
    const table = new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap();

    beforeAll(async () => {
      if (!integrationEnabled) return;
      container = await new PostgreSqlContainer(
        process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
      ).start();
      db = await createV2PostgresDb<V1TeableDatabase>({
        pg: { connectionString: container.getConnectionUri(), pool: { max: 1 } },
      });
      executor = new PostgresDataQueryExecutor(db);
      await sql`create schema ${sql.id(schema)}`.execute(db);
      await sql`create table ${sql.id(schema, physicalTable)} (
      __id text primary key,
      category text not null,
      cohort text not null,
      score double precision
    )`.execute(db);
      await sql`insert into ${sql.id(schema, physicalTable)} (__id, category, cohort, score)
      select 'rec' || lpad(n::text, 16, '0'),
        'customer-' || ((n - 1) / 100 % 10)::text,
        case when n % 100 = 0 then 'rare' else 'common' end,
        case when n % 17 = 0 then null else (n - 1) / 1000 end
      from generate_series(1, 20000) as n`.execute(db);
      await sql`analyze ${sql.id(schema, physicalTable)}`.execute(db);
    }, 120_000);

    afterAll(async () => {
      await db?.destroy();
      await container?.stop();
    });

    for (const cohort of ['rare', 'common'] as const) {
      const caseName = cohort === 'rare' ? 'high-selectivity' : 'low-selectivity';
      it(`matches reference SQL at 20k rows: ${caseName}`, async () => {
        const definition = DataQueryDefinition.create({
          version: 9,
          kind: 'records',
          tableId,
          filter: { fieldId: cohortId, operator: 'is', value: cohort },
          select: [
            { fieldId: categoryId, alias: 'category' },
            { fieldId: scoreId, alias: 'score' },
            { system: 'id', alias: 'id' },
          ],
          topN: {
            partitionBy: ['category'],
            orderBy: [{ alias: 'score', order: 'desc', nulls: 'last' }],
            limit: 3,
          },
          sort: [
            { alias: 'category', order: 'asc', nulls: 'first' },
            { alias: 'score', order: 'desc', nulls: 'last' },
          ],
          page: { limit: 10, offset: 0, includeTotal: true },
        })._unsafeUnwrap();
        const query = definition.bind({})._unsafeUnwrap();
        const actual = (await executor.execute(context, table, query, {}))._unsafeUnwrap();
        const compiled = executor.compile(context, table, query, {})._unsafeUnwrap();
        const explained = await db!.executeQuery<{ 'QUERY PLAN': [{ Plan: unknown }] }>(
          CompiledQuery.raw(`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${compiled.sql}`, [
            ...compiled.parameters,
          ])
        );
        const [report] = explained.rows[0]['QUERY PLAN'];
        console.info(JSON.stringify({ diagnostic: 'top-n-plan', cohort, report }));
        expect(JSON.stringify(report.Plan)).toContain('"Node Type":"WindowAgg"');
        const reference = await sql<{
          category: string;
          score: number | string | null;
          id: string;
        }>`with selected as (
        select category, score, __id as id
        from ${sql.id(schema, physicalTable)}
        where cohort = ${cohort}
      ), ranked as (
        select selected.*,
          row_number() over (
            partition by category
            order by score desc nulls last, id asc
          ) as rank
        from selected
      )
      select category, score, id
      from ranked
      where rank <= 3
      order by category asc nulls first, score desc nulls last, id asc
      limit 10 offset 0`.execute(db!);
        const count = await sql<{ total: string }>`with selected as (
        select category, score, __id as id
        from ${sql.id(schema, physicalTable)}
        where cohort = ${cohort}
      ), ranked as (
        select row_number() over (
          partition by category
          order by score desc nulls last, id asc
        ) as rank
        from selected
      )
      select count(*) as total from ranked where rank <= 3`.execute(db!);

        expect(actual.rows).toEqual(
          reference.rows.map((row) => ({
            ...row,
            score: row.score === null ? null : Number(row.score),
          }))
        );
        expect(actual.page?.total).toBe(Number(count.rows[0]?.total));
        expect(actual.page?.total).toBe(30);
      });
    }
  });
