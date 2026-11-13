import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  type ITablePersistenceDTO,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import {
  DataQueryDefinition,
  DataQueryRelationBinding,
  type DataQueryDefinitionV5Input,
  type DataQueryRelationPlan,
} from '@teable/v2-data-query';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql, type CompiledQuery, type Kysely } from 'kysely';
import type { Result } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

// Only a real server can prove planner shape and enforce the production statement budget.
const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const baseId = `bse${'p'.repeat(16)}`;
const tableIds = ['p', 'q', 'r'].map((seed) => `tbl${seed.repeat(16)}`);
const valueIds = ['p', 'q', 'r'].map((seed) => `fld${seed.repeat(16)}`);
const linkIds = ['s', 't'].map((seed) => `fld${seed.repeat(16)}`);
const tableNames = ['existence_roots', 'existence_targets', 'existence_leaves'];
const junctionNames = ['existence_root_target', 'existence_target_leaf'];
const rootCount = 4000;
const linkedRootCount = 2800;
const context = { actorId: ActorId.create('existence-plan-actor')._unsafeUnwrap() };
const physical = (name: string) => sql.id(baseId, name);
const recordId = (value: number) => `row-${String(value).padStart(5, '0')}`;

const resultValue = <T>(result: Result<T, unknown>, stage: string): T => {
  if (result.isErr()) throw new Error(`${stage}: ${JSON.stringify(result.error)}`);
  return result.value;
};

const tables = tableIds.map((id, index) => {
  const dto: ITablePersistenceDTO = {
    id,
    baseId,
    name: `Existence ${index}`,
    dbTableName: `${baseId}.${tableNames[index]}`,
    primaryFieldId: valueIds[index],
    fields: [
      { id: valueIds[index], name: 'Value', type: 'number', dbFieldName: 'value' },
      ...(index < 2
        ? [
            {
              id: linkIds[index],
              name: 'Next',
              type: 'link' as const,
              dbFieldName: 'next',
              options: {
                relationship: 'manyMany' as const,
                foreignTableId: tableIds[index + 1],
                lookupFieldId: valueIds[index + 1],
                isOneWay: true,
                fkHostTableName: `${baseId}.${junctionNames[index]}`,
                selfKeyName: 'self_id',
                foreignKeyName: 'foreign_id',
              },
            },
          ]
        : []),
    ],
    views: [{ id: `viw${String(index).repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
  };
  return resultValue(new DefaultTableMapper().toDomain(dto), `map table ${index}`);
});

// Nodes are intentionally limited to fields used by the invariant, not a snapshot
// of one PG version's complete plan or an outright ban on legitimate indexed loops.
type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Join Filter'?: number;
  Plans?: PlanNode[];
};
const descendants = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(descendants),
];

const planFor = (
  input: DataQueryDefinitionV5Input,
  rootScope: RecordQueryPluginScope = {},
  sourceScopes: ReadonlyMap<string, RecordQueryPluginScope> = new Map()
): DataQueryRelationPlan => {
  const definition = resultValue(DataQueryDefinition.create(input), 'create definition');
  const targets = new Map<string, Table>([
    ['targets', tables[1]],
    ['leaves', tables[2]],
  ]);
  const binding = resultValue(
    DataQueryRelationBinding.prepare(definition, tables[0], targets),
    'prepare relation binding'
  );
  return {
    query: resultValue(definition.bind({}), 'bind parameters'),
    rootTable: tables[0],
    rootScope,
    sources: binding.sources.map((source) => ({
      alias: source.alias,
      table: targets.get(source.alias)!,
      linkFieldId: source.linkFieldId,
      scope: sourceScopes.get(source.alias) ?? {},
    })),
    plan: binding.plan,
  };
};

const inputFor = (
  quantifier: 'any' | 'none',
  filtered: boolean,
  via: boolean
): Extract<DataQueryDefinitionV5Input, { kind: 'records' }> => ({
  version: 5,
  kind: 'records',
  tableId: tableIds[0],
  relations: {
    targets: {
      linkFieldId: linkIds[0],
      tableId: tableIds[1],
      ...(!via && filtered
        ? { filter: { fieldId: valueIds[1], operator: 'isGreater', value: 2000 } }
        : {}),
    },
    ...(via
      ? {
          leaves: {
            via: 'targets',
            linkFieldId: linkIds[1],
            tableId: tableIds[2],
            ...(filtered
              ? { filter: { fieldId: valueIds[2], operator: 'isGreater', value: 1000 } }
              : {}),
          },
        }
      : {}),
  },
  filter: { relation: via ? 'leaves' : 'targets', quantifier },
  select: [{ system: 'id', alias: 'id' }],
  page: { limit: 10, includeTotal: true },
});

const scenarios = (['any', 'none'] as const).flatMap((quantifier) =>
  [false, true].flatMap((filtered) => [false, true].map((via) => ({ quantifier, filtered, via })))
);

describePg('PostgresDataQueryExecutor junction existence plans (Postgres)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: Kysely<V1TeableDatabase>;
  let executor: PostgresDataQueryExecutor;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    ).start();
    db = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString: container.getConnectionUri(), pool: { max: 1 } },
    });
    executor = new PostgresDataQueryExecutor(db); // Keep the default 4000ms budget.
    await sql`create schema ${sql.id(baseId)}`.execute(db);
    for (const name of tableNames) {
      await sql`create table ${physical(name)} (__id text primary key, value numeric)`.execute(db);
      await sql`insert into ${physical(name)}
        select 'row-' || lpad(i::text, 5, '0'), i from generate_series(1, ${rootCount}) as i`.execute(
        db
      );
    }
    for (const name of junctionNames) {
      await sql`create table ${physical(name)} (
        self_id text not null, foreign_id text not null, primary key (self_id, foreign_id)
      )`.execute(db);
    }
    // Two distinct edges per linked root: a target may serve multiple roots, but
    // existence must neither multiply roots nor evaluate unlinked target rows.
    await sql`insert into ${physical(junctionNames[0])}
      select 'row-' || lpad(i::text, 5, '0'), 'row-' || lpad((i + edge_offset)::text, 5, '0')
      from generate_series(1, ${linkedRootCount}) as i cross join generate_series(0, 1) as edge_offset`.execute(
      db
    );
    await sql`insert into ${physical(junctionNames[1])}
      select 'row-' || lpad(i::text, 5, '0'), 'row-' || lpad(i::text, 5, '0')
      from generate_series(2, 2000, 2) as i`.execute(db);
    for (const name of [...tableNames, ...junctionNames]) {
      await sql`analyze ${physical(name)}`.execute(db);
    }
  }, 60_000);

  afterAll(async () => {
    try {
      await db?.destroy();
    } finally {
      // A private container owns every fixture relation; no shared-schema cleanup
      // or fixed external database state can interfere with parallel spec files.
      await container?.stop();
    }
  });

  const assertLinearTargetWork = async (compiled: CompiledQuery<unknown>) => {
    const document = await db.transaction().execute(async (transaction) => {
      await sql`select set_config('statement_timeout', '4000', true)`.execute(transaction);
      const explained = await transaction.executeQuery<{ 'QUERY PLAN': { Plan: PlanNode }[] }>({
        ...compiled,
        sql: `explain (analyze, format json, timing off) ${compiled.sql}`,
      });
      return explained.rows[0]['QUERY PLAN'][0].Plan;
    });
    const nodes = descendants(document);
    const targetNames = new Set(tableNames.slice(1));
    const targetNodes = nodes.filter(
      (node) => node['Relation Name'] !== undefined && targetNames.has(node['Relation Name'])
    );
    expect(targetNodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      if (descendants(node).some((child) => targetNames.has(child['Relation Name'] ?? ''))) {
        const rejectedPairs = node['Actual Loops'] * (node['Rows Removed by Join Filter'] ?? 0);
        expect(rejectedPairs, JSON.stringify(node)).toBeLessThanOrEqual(rootCount * 32);
      }
      const targetScan =
        node['Relation Name'] !== undefined && targetNames.has(node['Relation Name']);
      const targetMaterialize =
        node['Node Type'] === 'Materialize' &&
        descendants(node).some((child) => targetNames.has(child['Relation Name'] ?? ''));
      if (!targetScan && !targetMaterialize) continue;
      // Count tuples revisited by a repeated scan/materialization, including rows
      // discarded by a scan filter. Point-index probes are fine; replaying all
      // 4000 targets for each of 4000 roots is not (16M vs this linear 128K cap).
      const visited =
        node['Actual Loops'] * (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0));
      expect(visited, JSON.stringify(node)).toBeLessThanOrEqual(rootCount * 32);
    }
  };

  const executePlan = async (plan: DataQueryRelationPlan) =>
    resultValue(await executor.executeRelation(context, plan), `execute ${plan.plan.kind}`);

  it.each(scenarios)(
    '$quantifier filtered=$filtered via=$via executes rows/count, late totals and aggregate without root × target work',
    async ({ quantifier, filtered, via }) => {
      const expected = Array.from({ length: rootCount }, (_, index) => index + 1).filter(
        (value) => {
          const member = via
            ? value <= 2000 && (!filtered || value > 1000)
            : value <= linkedRootCount && (!filtered || value >= 2000);
          return quantifier === 'any' ? member : !member;
        }
      );
      const input = inputFor(quantifier, filtered, via);
      const plan = planFor(input);
      const compiled = resultValue(
        await executor.compileRelation(context, plan),
        'compile records'
      );
      expect(compiled.count).toBeDefined();
      expect(await executePlan(plan)).toEqual({
        rows: expected.slice(0, 10).map((value) => ({ id: recordId(value) })),
        page: { limit: 10, offset: 0, total: expected.length },
      });
      await assertLinearTargetWork(compiled.rows);
      await assertLinearTargetWork(compiled.count!);

      const latePlan = planFor({ ...input, page: { limit: 10, offset: 5000, includeTotal: true } });
      expect(await executePlan(latePlan)).toEqual({
        rows: [],
        page: { limit: 10, offset: 5000, total: expected.length },
      });
      const { select: _select, ...aggregateInput } = input;
      const aggregatePlan = planFor({
        ...aggregateInput,
        kind: 'aggregate',
        aggregates: [{ fieldId: valueIds[0], statisticFunc: 'sum', alias: 'total' }],
      });
      expect(await executePlan(aggregatePlan)).toEqual({
        rows: [{ total: expected.reduce((sum, value) => sum + value, 0) }],
        page: { limit: 10, offset: 0, total: 1 },
      });
      await assertLinearTargetWork(
        resultValue(await executor.compileRelation(context, aggregatePlan), 'compile aggregate')
          .rows
      );
    },
    30_000
  );

  it('keeps intermediate row visibility inside any/none across junction hops', async () => {
    const sourceScopes = new Map<string, RecordQueryPluginScope>([
      [
        'targets',
        {
          recordSpec: resultValue(
            buildRecordConditionSpec(tables[1], {
              fieldId: valueIds[1],
              operator: 'isGreater',
              value: 500,
            }),
            'build intermediate visibility'
          ),
        },
      ],
    ]);
    for (const quantifier of ['any', 'none'] as const) {
      const plan = planFor(inputFor(quantifier, false, true), {}, sourceScopes);
      const result = await executePlan(plan);
      // Visible even targets 502..2000 are reachable from roots 501..2000.
      expect(result.page?.total).toBe(quantifier === 'any' ? 1500 : 2500);
      expect(result.rows).toEqual(
        Array.from({ length: 10 }, (_, index) => ({
          id: recordId((quantifier === 'any' ? 501 : 1) + index),
        }))
      );
      const compiled = resultValue(
        await executor.compileRelation(context, plan),
        'compile scoped records'
      );
      await assertLinearTargetWork(compiled.count!);
    }
  });

  it('rejects conditionally masked Link dependencies for both quantifiers', async () => {
    const rootScope: RecordQueryPluginScope = {
      fieldMasks: [
        {
          fieldId: linkIds[0],
          visibleWhen: resultValue(
            buildRecordConditionSpec(tables[0], {
              fieldId: valueIds[0],
              operator: 'isLessEqual',
              value: 1000,
            }),
            'build Link mask'
          ),
        },
      ],
    };
    for (const quantifier of ['any', 'none'] as const) {
      const result = await executor.compileRelation(
        context,
        planFor(inputFor(quantifier, false, true), rootScope)
      );
      expect(result.isErr()).toBe(true);
      if (result.isErr())
        expect(result.error).toMatchObject({ code: 'data_query.field_forbidden' });
    }
  });
});
