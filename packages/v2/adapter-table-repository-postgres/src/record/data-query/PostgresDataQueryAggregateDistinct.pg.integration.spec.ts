import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  DefaultTableMapper,
  RecordByIdSpec,
  RecordId,
  type ITablePersistenceDTO,
  type Table,
} from '@teable/v2-core';
import {
  DataQueryDefinition,
  DataQueryRelationBinding,
  type DataQueryRelationPlan,
} from '@teable/v2-data-query';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql, type CompiledQuery, type Kysely, type RawBuilder } from 'kysely';
import type { Result } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const baseId = `bse${'d'.repeat(16)}`;
const rootId = `tbl${'d'.repeat(16)}`;
const childId = `tbl${'e'.repeat(16)}`;
const fieldIds = ['d', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map(
  (seed) => `fld${seed.repeat(16)}`
);
const [groupId, secondGroupId, thirdGroupId, rootAmountId, linkId, firstId, secondId, thirdId, amountId] =
  fieldIds;
const context = { actorId: ActorId.create('aggregate-distinct-plan-actor')._unsafeUnwrap() };
const physical = (name: string) => sql.id(baseId, name);
const parentCount = 20_000;
const childCount = 2000;
const edgeCount = 244_006;
const statementTimeout = '4000';

const resultValue = <T>(result: Result<T, unknown>, stage: string): T => {
  if (result.isErr()) throw new Error(`${stage}: ${JSON.stringify(result.error)}`);
  return result.value;
};

type Fixture = {
  name: string;
  roots: string;
  children: string;
  junction: string;
  parents: number;
  targets: number;
  edges: number;
  root: Table;
  child: Table;
};

const fixtureFor = (name: string, parents: number, targets: number, edges: number): Fixture => {
  const roots = `${name}_parents`;
  const children = `${name}_children`;
  const junction = `${name}_edges`;
  const rootDto: ITablePersistenceDTO = {
    id: rootId,
    baseId,
    name: 'Distinct parents',
    dbTableName: `${baseId}.${roots}`,
    primaryFieldId: groupId,
    fields: [
      { id: groupId, name: 'Group', type: 'singleLineText', dbFieldName: 'group_key' },
      { id: secondGroupId, name: 'Second group', type: 'singleLineText', dbFieldName: 'group_two' },
      { id: thirdGroupId, name: 'Third group', type: 'number', dbFieldName: 'group_three' },
      { id: rootAmountId, name: 'Parent amount', type: 'number', dbFieldName: 'amount' },
      {
        id: linkId,
        name: 'Children',
        type: 'link',
        dbFieldName: 'children',
        options: {
          relationship: 'manyMany',
          foreignTableId: childId,
          lookupFieldId: firstId,
          isOneWay: true,
          fkHostTableName: `${baseId}.${junction}`,
          selfKeyName: 'parent_id',
          foreignKeyName: 'child_id',
        },
      },
    ],
    views: [{ id: `viw${'d'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
  };
  const childDto: ITablePersistenceDTO = {
    id: childId,
    baseId,
    name: 'Distinct children',
    dbTableName: `${baseId}.${children}`,
    primaryFieldId: firstId,
    fields: [
      { id: firstId, name: 'First', type: 'singleLineText', dbFieldName: 'key_one' },
      { id: secondId, name: 'Second', type: 'singleLineText', dbFieldName: 'key_two' },
      { id: thirdId, name: 'Third', type: 'singleLineText', dbFieldName: 'key_three' },
      { id: amountId, name: 'Amount', type: 'number', dbFieldName: 'amount' },
    ],
    views: [{ id: `viw${'e'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
  };
  const mapper = new DefaultTableMapper();
  return {
    name,
    roots,
    children,
    junction,
    parents,
    targets,
    edges,
    root: resultValue(mapper.toDomain(rootDto), 'map parents'),
    child: resultValue(mapper.toDomain(childDto), 'map children'),
  };
};

const tiny = fixtureFor('distinct_tiny', 7, 7, 11);
const large = fixtureFor('distinct_large', parentCount, childCount, edgeCount);
const era = fixtureFor('distinct_era', 2, 2, 2);
const nonFinite = fixtureFor('distinct_nonfinite', 3, 3, 3);
const keyExpression = (fieldId: string) => ({
  type: 'formula' as const,
  formula: '{key}',
  references: { key: { type: 'field' as const, fieldId } },
});
const grouping = (keys: 1 | 3) => [
  { fieldId: groupId, alias: 'group' },
  ...(keys === 3
    ? [
        { fieldId: secondGroupId, alias: 'secondGroup' },
        { fieldId: thirdGroupId, alias: 'thirdGroup' },
      ]
    : []),
];
const definitionFor = (keys: 1 | 3, limit = 1000, offset = 0, having = false) =>
  resultValue(
    DataQueryDefinition.create({
      version: 8,
      kind: 'aggregate',
      tableId: rootId,
      relations: { children: { linkFieldId: linkId, tableId: childId } },
      groupBy: grouping(keys),
      aggregates: [
        { fieldId: rootAmountId, statisticFunc: 'count', alias: 'parents' },
        { fieldId: rootAmountId, statisticFunc: 'sum', alias: 'parentSum' },
        {
          source: 'children',
          statisticFunc: 'unique',
          distinctBy: [keyExpression(firstId)],
          alias: 'oneKey',
        },
        {
          source: 'children',
          statisticFunc: 'unique',
          distinctBy: [keyExpression(firstId), keyExpression(secondId), keyExpression(thirdId)],
          alias: 'threeKeys',
        },
        { source: 'children', fieldId: firstId, statisticFunc: 'unique', alias: 'fieldUnique' },
        { source: 'children', fieldId: amountId, statisticFunc: 'sum', alias: 'childSum' },
        { source: 'children', fieldId: amountId, statisticFunc: 'average', alias: 'childAverage' },
        { source: 'children', statisticFunc: 'count', alias: 'children' },
      ],
      ...(having
        ? {
            having: {
              type: 'formula',
              formula: '{tuples} > 3',
              references: { tuples: { type: 'output', alias: 'threeKeys' } },
            },
          }
        : {}),
      sort: grouping(keys).map(({ alias }) => ({ alias, order: 'asc', nulls: 'last' })),
      page: { limit, offset, includeTotal: true },
    }),
    'create aggregate'
  );

const planFor = (fixture: Fixture, definition: DataQueryDefinition): DataQueryRelationPlan => {
  const targets = new Map([['children', fixture.child]]);
  const binding = resultValue(
    DataQueryRelationBinding.prepare(definition, fixture.root, targets),
    'prepare relation binding'
  );
  return {
    query: resultValue(definition.bind({}), 'bind aggregate'),
    rootTable: fixture.root,
    rootScope: {},
    sources: binding.sources.map((source) => ({
      alias: source.alias,
      table: fixture.child,
      linkFieldId: source.linkFieldId,
      scope: {},
    })),
    plan: binding.plan,
  };
};

type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Parent Relationship'?: string;
  'Subplan Name'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Join Filter'?: number;
  'Total Cost': number;
  Plans?: PlanNode[];
};
type ExplainDocument = {
  Plan: PlanNode;
  'Execution Time': number;
  'Planning Time': number;
  JIT?: { Functions?: number; Timing?: Record<string, number> };
};
const descendants = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(descendants),
];
const tupleWork = (node: PlanNode) =>
  node['Actual Loops'] * (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0));

type OracleRow = Record<string, string | number | null>;
const numericAliases = [
  'parents',
  'parentSum',
  'oneKey',
  'threeKeys',
  'fieldUnique',
  'childSum',
  'childAverage',
  'children',
];
// Aggregate outputs normalize to public numbers; native NUMERIC group keys retain
// the driver's exact strings so the oracle also checks the public group values.
const normalizeOracle = (row: OracleRow): Record<string, string | number | null> =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      numericAliases.includes(key) && value !== null ? Number(value) : value,
    ])
  );

// Rank actual grouping columns once, including SQL NULL groups. Joining the
// resulting non-null ordinal keeps the oracle independent of production's group
// join encoding and avoids 20000 × 20000 IS NOT DISTINCT FROM comparisons.
// Tuple identity below is SELECT DISTINCT over actual scalar columns, never JSON.
const oracleFor = (
  fixture: Fixture,
  keys: 1 | 3,
  having: boolean,
  recordId?: string
): RawBuilder<OracleRow> => {
  const columns = keys === 1 ? ['group_key'] : ['group_key', 'group_two', 'group_three'];
  const groupColumns = sql.join(columns.map((column) => sql.id(column)));
  const output = [
    sql`r.group_key as ${sql.id('group')}`,
    ...(keys === 3
      ? [sql`r.group_two as ${sql.id('secondGroup')}`, sql`r.group_three as ${sql.id('thirdGroup')}`]
      : []),
  ];
  return sql<OracleRow>`with
    ranked_roots as (
      select p.*, dense_rank() over (order by ${groupColumns}) as group_id
      from ${physical(fixture.roots)} p ${recordId ? sql`where p.__id = ${recordId}` : sql``}
    ), root_grain as (
      select group_id, ${groupColumns}, count(*) as parents, sum(amount) as parent_sum
      from ranked_roots group by group_id, ${groupColumns}
    ), edges as (
      select distinct parent_id, child_id from ${physical(fixture.junction)}
    ), inputs as (
      select p.group_id, p.__id as parent_id, c.__id as child_id,
        c.key_one, c.key_two, c.key_three, c.amount
      from ranked_roots p
      join edges e on e.parent_id = p.__id
      join ${physical(fixture.children)} c on c.__id = e.child_id
    ), relation_grain as (
      select group_id, count(*) as children, sum(amount) as child_sum,
        avg(amount) as child_average, count(distinct key_one) as field_unique
      from inputs group by group_id
    ), one_key as (
      select group_id, count(*) as n from (
        select distinct group_id, key_one from inputs
      ) d group by group_id
    ), three_keys as (
      select group_id, count(*) as n from (
        select distinct group_id, key_one, key_two, key_three from inputs
      ) d group by group_id
    )
    select ${sql.join(output)}, r.parents, r.parent_sum as ${sql.id('parentSum')},
      coalesce(o.n, 0) as ${sql.id('oneKey')}, coalesce(t.n, 0) as ${sql.id('threeKeys')},
      coalesce(s.field_unique, 0) as ${sql.id('fieldUnique')},
      s.child_sum as ${sql.id('childSum')}, s.child_average as ${sql.id('childAverage')},
      coalesce(s.children, 0) as children
    from root_grain r
    left join relation_grain s on r.group_id = s.group_id
    left join one_key o on r.group_id = o.group_id
    left join three_keys t on r.group_id = t.group_id
    ${having ? sql`where coalesce(t.n, 0) > 3` : sql``}
    order by ${sql.join(columns.map((column) => sql`${sql.id('r', column)} asc nulls last`))}`;
};

describePg('T8561 grouped relation DISTINCT production plans (Postgres 16)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: Kysely<V1TeableDatabase>;
  let executor: PostgresDataQueryExecutor;
  let jitAboveCost: number;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    ).start();
    db = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString: container.getConnectionUri(), pool: { max: 1 } },
    });
    executor = new PostgresDataQueryExecutor(db);
    const version = await sql<{ server_version_num: string }>`show server_version_num`.execute(db);
    expect(Math.floor(Number(version.rows[0].server_version_num) / 10_000)).toBe(16);
    // Retain the server's real JIT threshold and the executor's default budget.
    const jit = await sql<{ jit: string }>`show jit`.execute(db);
    expect(jit.rows[0].jit).toBe('on');
    const threshold = await sql<{ jit_above_cost: string }>`show jit_above_cost`.execute(db);
    jitAboveCost = Number(threshold.rows[0].jit_above_cost);
    expect(jitAboveCost).toBeGreaterThan(0);
    await sql`create schema ${sql.id(baseId)}`.execute(db);
    for (const fixture of [tiny, large, era, nonFinite]) {
      await sql`create table ${physical(fixture.roots)} (
        __id text primary key, group_key text, group_two text, group_three numeric, amount numeric
      )`.execute(db);
      await sql`create table ${physical(fixture.children)} (
        __id text primary key, key_one text, key_two text, key_three text, amount numeric
      )`.execute(db);
      // Duplicate physical edges are deliberate: membership is parent × child,
      // while a child linked to different parents contributes to each parent's sum.
      await sql`create table ${physical(fixture.junction)} (
        parent_id text not null, child_id text not null
      )`.execute(db);
      await sql`create index on ${physical(fixture.junction)} (parent_id, child_id)`.execute(db);
    }
    await sql`insert into ${physical(tiny.roots)} values
      ('p1', 'G', 'bucket', 1, 1), ('p2', 'G', 'bucket', 1, 2),
      ('p3', 'G', 'bucket', 1, 3), ('p4', 'G', 'bucket', 1, 4),
      ('p5', null, null, null, 5), ('p6', null, null, null, 6),
      ('p7', 'empty', null, null, 7)`.execute(db);
    await sql`insert into ${physical(tiny.children)} values
      ('c1', 'A', 'B', 'x', 10), ('c2', 'A', 'C', 'y', 30),
      ('c3', 'A', 'B', 'x', 10), ('c4', null, null, null, null),
      ('c5', null, null, null, null), ('c6', 'D', null, 'z', 50),
      ('c7', 'A', 'B', 'different', 70)`.execute(db);
    await sql`insert into ${physical(tiny.junction)} values
      ('p1', 'c1'), ('p1', 'c1'), ('p1', 'c2'), ('p2', 'c1'), ('p2', 'c3'),
      ('p3', 'c4'), ('p4', 'c5'), ('p4', 'c6'), ('p5', 'c7'), ('p5', 'c1'),
      ('p6', 'c4')`.execute(db);
    await sql`insert into ${physical(era.roots)} values
      ('p1', 'era', null, null, 0), ('p2', 'era', null, null, -1)`.execute(db);
    await sql`insert into ${physical(era.children)} values
      ('c1', 'era', null, null, 0), ('c2', 'era', null, null, -1)`.execute(db);
    await sql`insert into ${physical(era.junction)} values
      ('p1', 'c1'), ('p2', 'c2')`.execute(db);
    await sql`insert into ${physical(nonFinite.roots)} values
      ('p1', 'infinity', null, null, 0), ('p2', '-infinity', null, null, 0),
      ('p3', null, null, null, 0)`.execute(db);
    await sql`insert into ${physical(nonFinite.children)} values
      ('c1', 'infinity', null, null, 0), ('c2', '-infinity', null, null, 0),
      ('c3', null, null, null, 0)`.execute(db);
    await sql`insert into ${physical(nonFinite.junction)} values
      ('p1', 'c1'), ('p2', 'c2'), ('p3', 'c3')`.execute(db);
    await sql`insert into ${physical(large.roots)}
      select 'recp' || i, case when i % 50 = 0 then null else 'g' || lpad((i % 50)::text, 2, '0') end,
        case when i % 50 = 0 then null else 'bucket-' || (i % 5) end,
        case when i % 50 = 0 then null else i % 10 end, i % 101
      from generate_series(1, ${parentCount}) i`.execute(db);
    await sql`insert into ${physical(large.children)}
      select 'c' || i,
        case when i % 17 = 0 then null else 'A' || (i % 97) end,
        case when i % 19 = 0 then null else 'B' || (i % 13) end,
        case when i % 23 = 0 then null else 'C' || (i % 11) end,
        case when i % 29 = 0 then null else (i % 103)::numeric end
      from generate_series(1, ${childCount}) i`.execute(db);
    // 240000 base memberships plus 4006 extra memberships. Extra edges favor
    // c2000's amount; c1987 is 13 places away and cannot overlap the same
    // 12-child base interval. This makes AVG(parent AVG) observably incorrect.
    await sql`insert into ${physical(large.junction)}
      select 'recp' || i, 'c' || ((i * 13 + edge_offset) % ${childCount} + 1)
      from generate_series(1, ${parentCount}) i cross join generate_series(0, 11) edge_offset
      union all
      select 'recp' || i, 'c' || case
        when ((1999 - i * 13) % ${childCount} + ${childCount}) % ${childCount} between 0 and 11
        then 1987 else 2000 end
      from generate_series(1, 4006) i`.execute(db);
    for (const fixture of [tiny, large, era, nonFinite]) {
      for (const name of [fixture.roots, fixture.children, fixture.junction]) {
        await sql`analyze ${physical(name)}`.execute(db);
      }
      const counts = await sql<{ parents: string; children: string; edges: string }>`select
        (select count(*) from ${physical(fixture.roots)}) as parents,
        (select count(*) from ${physical(fixture.children)}) as children,
        (select count(*) from ${physical(fixture.junction)}) as edges`.execute(db);
      expect(Object.values(counts.rows[0]).map(Number)).toEqual([
        fixture.parents,
        fixture.targets,
        fixture.edges,
      ]);
    }
  }, 60_000);

  afterAll(async () => {
    try {
      await db?.destroy();
    } finally {
      await container?.stop();
    }
  });

  const explain = async (fixture: Fixture, label: string, compiled: CompiledQuery<unknown>) => {
    const document = await db.transaction().execute(async (transaction) => {
      await sql`select set_config('statement_timeout', ${statementTimeout}, true)`.execute(transaction);
      const timeout = await sql<{ statement_timeout: string }>`show statement_timeout`.execute(
        transaction
      );
      expect(timeout.rows[0].statement_timeout).toBe('4s');
      const result = await transaction.executeQuery<{ 'QUERY PLAN': ExplainDocument[] }>({
        ...compiled,
        sql: `explain (analyze, buffers, format json, timing off) ${compiled.sql}`,
      });
      return result.rows[0]['QUERY PLAN'][0];
    });
    const nodes = descendants(document.Plan);
    const relations = new Set([fixture.roots, fixture.children, fixture.junction]);
    const scans = nodes.filter((node) => relations.has(node['Relation Name'] ?? ''));
    expect(scans.length).toBeGreaterThan(0);
    const replayNodes = nodes.filter(
      (node) =>
        ['Materialize', 'CTE Scan', 'WorkTable Scan'].includes(node['Node Type']) ||
        relations.has(node['Relation Name'] ?? '')
    );
    const work = replayNodes.reduce((total, node) => total + tupleWork(node), 0);
    const rejectedPairs = nodes.reduce(
      (total, node) => total + node['Actual Loops'] * (node['Rows Removed by Join Filter'] ?? 0),
      0
    );
    const linearBudget = Math.max(fixture.edges + fixture.parents + fixture.targets, 1) * 16;
    expect(work, `${label}: tuple scan/materialize replay`).toBeLessThanOrEqual(linearBudget);
    expect(rejectedPairs, `${label}: rejected join pairs`).toBeLessThanOrEqual(linearBudget);
    for (const node of nodes) {
      const subplan = node['Parent Relationship'] === 'SubPlan';
      if (!subplan || node['Actual Loops'] <= 1) continue;
      const nested = descendants(node);
      // Scalar formula Result nodes and genuine index point probes may repeat.
      // A junction EXISTS per expanded edge, or a finalizer rescanning group
      // membership once per output group, must not survive as a correlated plan.
      const junctionProbe = nested.some((child) => child['Relation Name'] === fixture.junction);
      const groupReplay = nested.some((child) =>
        ['CTE Scan', 'Materialize', 'WorkTable Scan'].includes(child['Node Type'])
      );
      if (junctionProbe) {
        expect(node['Actual Loops'], `${label}: correlated junction subplan`).toBeLessThanOrEqual(
          fixture.parents
        );
      }
      if (groupReplay) {
        expect(node['Actual Loops'], `${label}: correlated group finalizer`).toBe(1);
      }
    }
    const functions = document.JIT?.Functions ?? 0;
    // Tiny inputs must never trigger JIT through inflated planner cost. Large
    // inputs may legitimately use JIT; their four-second and linear-work bounds
    // remain mandatory. Runtime milliseconds are evidence, not hardware gates.
    if (fixture === tiny) {
      expect(document.Plan['Total Cost'], `${label}: JIT threshold`).toBeLessThan(jitAboveCost);
      expect(functions, `${label}: actual JIT functions`).toBe(0);
    }
    console.info(
      JSON.stringify({
        evidence: 'T8561.aggregate-distinct.pg16',
        fixture: fixture.name,
        query: label,
        parents: fixture.parents,
        children: fixture.targets,
        edges: fixture.edges,
        statementTimeoutMs: 4000,
        jit: 'on',
        jitAboveCost,
        totalCost: document.Plan['Total Cost'],
        jitFunctions: functions,
        jitTimingMs: document.JIT?.Timing ?? null,
        planningMs: document['Planning Time'],
        executionMs: document['Execution Time'],
        scanReplayTuples: work,
        rejectedJoinPairs: rejectedPairs,
        linearBudget,
      })
    );
  };

  const assertRows = (actual: readonly Record<string, unknown>[], expected: readonly OracleRow[]) => {
    expect(actual).toHaveLength(expected.length);
    for (const [index, row] of actual.entries()) {
      const wanted = normalizeOracle(expected[index]);
      const { childAverage, ...exact } = wanted;
      const { childAverage: average, ...rest } = row;
      expect(rest).toEqual(exact);
      if (childAverage === null) expect(average).toBeNull();
      else expect(average).toBeCloseTo(Number(childAverage), 10);
    }
  };

  const prove = async (fixture: Fixture, keys: 1 | 3, expectedGroups: number) => {
    for (const having of [false, true]) {
      // Exercise the executor before either the oracle or EXPLAIN warms this
      // exact query shape; the budget applies to normal execution itself.
      const first = await executor.executeRelation(
        context,
        planFor(fixture, definitionFor(keys, 1000, 0, having))
      );
      if (first.isErr()) {
        const compiled = resultValue(
          await executor.compileRelation(context, planFor(fixture, definitionFor(keys, 1000, 0, having))),
          'compile failed aggregate plan'
        );
        const estimate = await db.transaction().execute(async (transaction) => {
          await sql`select set_config('statement_timeout', ${statementTimeout}, true)`.execute(
            transaction
          );
          return transaction.executeQuery({
            ...compiled.rows,
            sql: `explain (format json, costs true) ${compiled.rows.sql}`,
          });
        });
        console.error(
          JSON.stringify({
            evidence: 'T8561.aggregate-distinct.failed-plan',
            fixture: fixture.name,
            keys,
            having,
            statementTimeoutMs: 4000,
            jitAboveCost,
            sql: compiled.rows.sql,
            parameters: compiled.rows.parameters,
            plan: estimate.rows,
          })
        );
      }
      const firstPage = resultValue(first, 'execute first page before EXPLAIN');
      const expected = await db.transaction().execute(async (transaction) => {
        await sql`select set_config('statement_timeout', ${statementTimeout}, true)`.execute(
          transaction
        );
        return (await oracleFor(fixture, keys, having).execute(transaction)).rows;
      });
      if (!having) expect(expected).toHaveLength(expectedGroups);
      expect(firstPage.page).toEqual({ limit: 1000, offset: 0, total: expected.length });
      assertRows(firstPage.rows, expected.slice(0, 1000));
      const definition = definitionFor(keys, 1000, 0, having);
      const plan = planFor(fixture, definition);
      const compiled = resultValue(await executor.compileRelation(context, plan), 'compile aggregate');
      expect(compiled.count).toBeDefined();
      await explain(fixture, `${keys}keys.having=${having}.rows`, compiled.rows);
      await explain(fixture, `${keys}keys.having=${having}.count`, compiled.count!);
      // Sample the next, middle and final public-size pages. Each complete row
      // is compared with the independent full-result oracle and its exact total.
      const sampleOffsets = new Set([
        1000,
        Math.floor(expected.length / 2000) * 1000,
        Math.floor(Math.max(expected.length - 1, 0) / 1000) * 1000,
      ]);
      for (const offset of sampleOffsets) {
        if (offset === 0 || offset >= expected.length) continue;
        const paged = planFor(fixture, definitionFor(keys, 1000, offset, having));
        const actual = resultValue(await executor.executeRelation(context, paged), 'execute page');
        expect(actual.page).toEqual({ limit: 1000, offset, total: expected.length });
        assertRows(actual.rows, expected.slice(offset, offset + 1000));
      }
      const lateOffset = expectedGroups + 1;
      const late = resultValue(
        await executor.executeRelation(
          context,
          planFor(fixture, definitionFor(keys, 1, lateOffset, having))
        ),
        'execute late empty page'
      );
      expect(late).toEqual({
        rows: [],
        page: { limit: 1, offset: lateOffset, total: expected.length },
      });
      const limited = resultValue(
        await executor.executeRelation(context, planFor(fixture, definitionFor(keys, 1, 0, having))),
        'execute limited page'
      );
      expect(limited.page).toEqual({ limit: 1, offset: 0, total: expected.length });
      assertRows(limited.rows, expected.slice(0, 1));
    }
  };

  it.each([1, 3] as const)(
    'keeps tiny shared A/B, A/C, duplicate A, NULL tuples and empty memberships with %i grouping keys below JIT cost',
    async (keys) => {
      const actual = resultValue(
        await executor.executeRelation(context, planFor(tiny, definitionFor(keys))),
        'execute tiny semantics'
      );
      expect(
        actual.rows.map(({ group, oneKey, threeKeys, fieldUnique, children }) => ({
          group,
          oneKey,
          threeKeys,
          fieldUnique,
          children,
        }))
      ).toEqual([
        { group: 'G', oneKey: 3, threeKeys: 4, fieldUnique: 2, children: 7 },
        { group: 'empty', oneKey: 0, threeKeys: 0, fieldUnique: 0, children: 0 },
        { group: null, oneKey: 2, threeKeys: 3, fieldUnique: 1, children: 3 },
      ]);
      await prove(tiny, keys, 3);
    },
    60_000
  );

  it('keeps AD and BC datetime tuples distinct for root and relation metrics', async () => {
    const dateKey = (fieldId: string) => ({
      type: 'formula' as const,
      formula: 'DATE_ADD(DATETIME_PARSE("0001-01-01T00:00:00Z"), {offset}, "year")',
      references: { offset: { type: 'field' as const, fieldId } },
    });
    const definition = resultValue(
      DataQueryDefinition.create({
        version: 8,
        kind: 'aggregate',
        tableId: rootId,
        relations: { children: { linkFieldId: linkId, tableId: childId } },
        aggregates: [
          { statisticFunc: 'unique', distinctBy: [dateKey(rootAmountId)], alias: 'rootDates' },
          {
            source: 'children',
            statisticFunc: 'unique',
            distinctBy: [dateKey(amountId)],
            alias: 'childDates',
          },
        ],
      }),
      'create era aggregate'
    );
    const actual = resultValue(
      await executor.executeRelation(context, planFor(era, definition)),
      'execute era aggregate'
    );
    expect(actual.rows).toEqual([{ rootDates: 2, childDates: 2 }]);

    // The oracle uses native timestamp arithmetic and actual driver Dates,
    // independently of formula translation and the internal tuple key encoding.
    const oracle = await sql<{ source: string; value: Date }>`with offsets as (
      select 'root' as source, amount from ${physical(era.roots)}
      union all
      select 'children', c.amount from ${physical(era.roots)} p
      join ${physical(era.junction)} e on e.parent_id = p.__id
      join ${physical(era.children)} c on c.__id = e.child_id
    ) select source, timestamptz '0001-01-01T00:00:00Z' + amount * interval '1 year' as value
      from offsets order by source, amount desc`.execute(db);
    expect(oracle.rows.map(({ source, value }) => ({ source, iso: value.toISOString() }))).toEqual([
      { source: 'children', iso: '0001-01-01T00:00:00.000Z' },
      { source: 'children', iso: '0000-01-01T00:00:00.000Z' },
      { source: 'root', iso: '0001-01-01T00:00:00.000Z' },
      { source: 'root', iso: '0000-01-01T00:00:00.000Z' },
    ]);
  });

  it('collapses infinite and NULL datetime tuples like public records DISTINCT', async () => {
    const dateKey = (fieldId: string) => ({
      type: 'formula' as const,
      formula: 'DATETIME_PARSE({text})',
      references: { text: { type: 'field' as const, fieldId } },
    });
    const definition = resultValue(
      DataQueryDefinition.create({
        version: 8,
        kind: 'aggregate',
        tableId: rootId,
        relations: { children: { linkFieldId: linkId, tableId: childId } },
        aggregates: [
          { statisticFunc: 'unique', distinctBy: [dateKey(groupId)], alias: 'rootDates' },
          {
            source: 'children',
            statisticFunc: 'unique',
            distinctBy: [dateKey(firstId)],
            alias: 'childDates',
          },
        ],
      }),
      'create nonfinite aggregate'
    );
    const actual = resultValue(
      await executor.executeRelation(context, planFor(nonFinite, definition)),
      'execute nonfinite aggregate'
    );
    expect(actual.rows).toEqual([{ rootDates: 1, childDates: 1 }]);

    // Execute the existing public records finalizer as the equality oracle for
    // each source, rather than reimplementing the datetime normalization in SQL.
    for (const [table, tableId, fieldId, metric] of [
      [nonFinite.root, rootId, groupId, 'rootDates'],
      [nonFinite.child, childId, firstId, 'childDates'],
    ] as const) {
      const records = resultValue(
        DataQueryDefinition.create({
          version: 6,
          kind: 'records',
          tableId,
          distinct: true,
          select: [{ expr: dateKey(fieldId), alias: 'value' }],
        }),
        'create nonfinite records DISTINCT'
      );
      const publicValues = resultValue(
        await executor.execute(context, table, resultValue(records.bind({}), 'bind records'), {}),
        'execute nonfinite records DISTINCT'
      );
      expect(publicValues.rows).toEqual([{ value: null }]);
      expect(actual.rows[0][metric]).toBe(publicValues.rows.length);
    }
  });

  it('restricts source batches before aggregating one selected root in the large table', async () => {
    const base = planFor(large, definitionFor(3));
    const selectedId = 'recp1';
    const plan = {
      ...base,
      rootScope: {
        recordSpec: RecordByIdSpec.create(resultValue(RecordId.create(selectedId), 'selected ID')),
      },
    };
    const actual = resultValue(await executor.executeRelation(context, plan), 'execute selected root');
    const expected = await oracleFor(large, 3, false, selectedId).execute(db);
    expect(actual.page).toEqual({ limit: 1000, offset: 0, total: 1 });
    assertRows(actual.rows, expected.rows);
    const compiled = resultValue(await executor.compileRelation(context, plan), 'compile selected root');
    // The tables still contain 20k parents and 244006 edges. Budget work against
    // the selected parent and its 13 memberships, allowing the 2000 target rows.
    const selected = { ...large, name: 'distinct_large_record_p1', parents: 1, edges: 13 };
    await explain(selected, 'selected-root.rows', compiled.rows);
    expect(compiled.count).toBeDefined();
    await explain(selected, 'selected-root.count', compiled.count!);
  });

  it('retains weighted relation averages and linear rows/count work at 50 and 20000 groups', async () => {
    const averages = await sql<{ weighted: string; parent_average: string }>`with per_parent as (
      select p.__id, sum(c.amount) as total, count(c.amount) as n, avg(c.amount) as average
      from ${physical(large.roots)} p
      join ${physical(large.junction)} e on e.parent_id = p.__id
      join ${physical(large.children)} c on c.__id = e.child_id group by p.__id
    ) select sum(total) / sum(n) as weighted, avg(average) as parent_average from per_parent`.execute(db);
    expect(
      Math.abs(Number(averages.rows[0].weighted) - Number(averages.rows[0].parent_average))
    ).toBeGreaterThan(0.000001);
    for (const keys of [1, 3] as const) await prove(large, keys, 50);
    await sql`update ${physical(large.roots)} set group_key = __id`.execute(db);
    await sql`analyze ${physical(large.roots)}`.execute(db);
    for (const keys of [1, 3] as const) await prove(large, keys, parentCount);
  }, 240_000);
});
