import type { BoundDataQuery, BoundDataQueryPlan } from '@teable/v2-data-query';
import type { IPgTypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type RawBuilder } from 'kysely';

type Row = Record<string, unknown>;

// Use PostgreSQL's soft input check before conversion. It follows float8's
// actual rounding boundaries, including subnormals, rather than approximate
// decimal min/max clamps. JSON.parse turns overflow into nonfinite (wire null)
// and underflow into zero; PostgreSQL otherwise raises on those inputs.
const finalizeJsonNumber = (
  text: RawBuilder<unknown>,
  strategy: IPgTypeValidationStrategy
): RawBuilder<unknown> => sql`(select case
  when ${sql.raw(strategy.isValidForType('"__dq_float"."value"', 'double precision'))}
    then to_jsonb(("__dq_float"."value")::double precision)
  when abs(("__dq_float"."value")::numeric) < 1 then to_jsonb(0)
  else 'null'::jsonb end
  from (select ${text} as "value" offset 0) as "__dq_float")`;

// JSON drivers parse every numeric leaf as an IEEE-754 double. Walk only composite
// values, emit an ordered token stream and rebuild once (never jsonb_set per leaf).
const finalizeComposite = (
  value: RawBuilder<unknown>,
  strategy: IPgTypeValidationStrategy
): RawBuilder<unknown> => sql`(
  with recursive nodes(value, path, prefix) as (
    select ${value}::jsonb, array[]::bigint[], ''::text
    union all
    select child.value, nodes.path || child.ordinal,
      (case when child.ordinal > 1 then ',' else '' end) ||
      (case when child.key is null then '' else to_jsonb(child.key)::text || ':' end)
    from nodes cross join lateral (
      select entry.value, entry.key, entry.ordinality as ordinal
      from jsonb_each(case when jsonb_typeof(nodes.value) = 'object' then nodes.value else '{}'::jsonb end)
        with ordinality as entry(key, value, ordinality)
      union all
      select entry.value, null::text, entry.ordinality
      from jsonb_array_elements(case when jsonb_typeof(nodes.value) = 'array' then nodes.value else '[]'::jsonb end)
        with ordinality as entry(value, ordinality)
    ) as child
  ), tokens as (
    select path, prefix || case jsonb_typeof(value)
      when 'object' then '{'
      when 'array' then '['
      when 'number' then (${finalizeJsonNumber(sql`value #>> '{}'`, strategy)})::text
      else value::text end as token
    from nodes
    union all
    select path || 9223372036854775807::bigint,
      case jsonb_typeof(value) when 'object' then '}' else ']' end
    from nodes where jsonb_typeof(value) in ('array', 'object')
  ) select string_agg(token, '' order by path)::jsonb from tokens
)`;

const finalizeValue = (
  value: RawBuilder<unknown>,
  metric: boolean,
  strategy: IPgTypeValidationStrategy
): RawBuilder<unknown> => {
  // All branches use text/JSON casts, so PostgreSQL can type-check the CASE for
  // any admitted native scalar, JSON or SQL-array projection.
  const text = sql`(${value})::text`;
  const json = sql`to_jsonb(${value})`;
  const metricText = sql`"__dq_metric"."value"`;
  const numericMetric = sql`(select case
    when ${metricText} in ('NaN', 'Infinity', '-Infinity') then to_jsonb(${metricText})
    when not ${sql.raw(strategy.isValidForType('"__dq_metric"."value"', 'double precision'))} then
      case when abs((${metricText})::numeric) < 1 then to_jsonb(0) else to_jsonb(${metricText}) end
    when trunc((${metricText})::double precision) = (${metricText})::double precision and abs((${metricText})::double precision) > 9007199254740991::double precision then to_jsonb(${metricText})
    else to_jsonb((${metricText})::double precision) end
    from (select ${text} as "value" offset 0) as "__dq_metric")`;
  return sql`nullif(case when ${value} is null then null::jsonb
    when pg_typeof(${value})::text = 'numeric' then ${metric ? numericMetric : sql`to_jsonb(${text})`}
    when pg_typeof(${value})::text = 'bigint' then ${metric ? numericMetric : sql`to_jsonb(${text})`}
    when pg_typeof(${value})::text in ('timestamp with time zone', 'timestamp without time zone') then
      to_jsonb(to_char(date_trunc('milliseconds', (${text})::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    when pg_typeof(${value})::text in ('double precision', 'real') and ${text} in ('NaN', 'Infinity', '-Infinity') then null::jsonb
    when jsonb_typeof(${json}) in ('array', 'object') then ${finalizeComposite(json, strategy)}
    when jsonb_typeof(${json}) = 'number' and pg_typeof(${value})::text in ('json', 'jsonb') then ${finalizeJsonNumber(sql`${json} #>> '{}'`, strategy)}
    else ${json} end, 'null'::jsonb)`;
};

/** Both record compilers share exactly one finalized tuple, ordering and count. */
export const compileDistinctRecords = (
  db: Kysely<V1TeableDatabase>,
  projected: RawBuilder<unknown>,
  plan: BoundDataQueryPlan,
  bound: BoundDataQuery,
  strategy: IPgTypeValidationStrategy
) => {
  const finalized = plan.projections.map((projection) => {
    const value = sql`${sql.id('projected', projection.alias)}`;
    return sql`${finalizeValue(value, projection.kind === 'aggregate', strategy)} as ${sql.id(projection.alias)}`;
  });
  // Fence the completed public projection so formulas and lateral metrics are
  // evaluated once per source row, before physical-type normalization and dedup.
  const tuples = sql`select distinct ${sql.join(finalized)} from (${projected} offset 0) as ${sql.id('projected')}`;
  const sorts: Array<{ alias: string; order: 'asc' | 'desc'; nulls?: 'first' | 'last' }> = [];
  for (const sort of bound.sort) {
    if (!('alias' in sort)) throw new Error('DISTINCT sorts must be projected aliases');
    if (!sorts.some((item) => item.alias === sort.alias)) sorts.push(sort);
  }
  for (const projection of plan.projections)
    if (!sorts.some((sort) => sort.alias === projection.alias))
      sorts.push({ alias: projection.alias, order: 'asc' });
  const orders = sorts.flatMap((sort) => {
    const value = sql`${sql.id('tuples', sort.alias)}`;
    const direction = sort.order === 'asc' ? sql`asc` : sql`desc`;
    const nulls =
      (sort.nulls ?? (sort.order === 'asc' ? 'first' : 'last')) === 'first'
        ? sql`nulls first`
        : sql`nulls last`;
    return [
      sql`(case when ${value} is null then null when jsonb_typeof(${value}) = 'string' then 'string' else 'value' end) collate "C" ${direction} ${nulls}`,
      sql`(case when jsonb_typeof(${value}) = 'string' then ${value} #>> '{}' end) collate "C" ${direction} ${nulls}`,
      sql`(case when jsonb_typeof(${value}) <> 'string' then ${value} end) ${direction} ${nulls}`,
    ];
  });
  const selections = plan.projections.map(
    (projection) => sql`${sql.id('tuples', projection.alias)} as ${sql.id(projection.alias)}`
  );
  return {
    rows: sql<Row>`select ${sql.join(selections)} from (${tuples}) as ${sql.id('tuples')} order by ${sql.join(orders)} limit ${bound.limit} offset ${bound.offset}`.compile(
      db
    ),
    ...(bound.includeTotal
      ? {
          count: sql<{
            total: unknown;
          }>`select count(*) as ${sql.id('total')} from (${tuples}) as ${sql.id('tuples')}`.compile(
            db
          ),
        }
      : {}),
  };
};
