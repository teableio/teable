import type { BoundDataQueryComposition } from '@teable/v2-data-query';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type CompiledQuery, type Kysely, type RawBuilder } from 'kysely';

type Row = Record<string, unknown>;
type Metric = NonNullable<BoundDataQueryComposition['definition']['metrics']>[number];

const defaultCompositionLimit = 100;

export const sharedMetricGroupLimit = (composition?: BoundDataQueryComposition) => {
  const definition = composition?.definition;
  return definition?.metricDimensions && definition.groupBy?.length
    ? (definition.page?.limit ?? defaultCompositionLimit)
    : undefined;
};

const metricAggregate = (metric: Metric, input: RawBuilder<unknown> | undefined) => {
  switch (metric.statistic) {
    case 'count':
      return input ? sql`count(${input})` : sql`count(*)`;
    case 'sum':
      return sql`sum(${input!})`;
    case 'average':
      return sql`avg(${input!})`;
    case 'min':
      return sql`min(${input!})`;
    case 'max':
      return sql`max(${input!})`;
  }
};

const sourceColumn = (alias: string) => sql.id('source', alias);

const aggregateInput = (metric: Metric, decimalAlias: string | undefined, shared: boolean) => {
  if (decimalAlias !== undefined) return sourceColumn(decimalAlias);
  if (metric.input === undefined) return undefined;
  const input = sourceColumn(metric.input);
  // Float-to-text preserves the shortest round-trip value before decimal accumulation.
  return shared && (metric.statistic === 'sum' || metric.statistic === 'average')
    ? sql`${input}::text::numeric`
    : input;
};

function compileMonthComparison(
  db: Kysely<V1TeableDatabase>,
  source: RawBuilder<unknown>,
  metric: Metric,
  comparison: NonNullable<BoundDataQueryComposition['monthComparison']>,
  predicates: RawBuilder<unknown>[],
  decimalMetricAlias: string | undefined
) {
  const { dimension, currentMonth, previousMonth } = comparison;
  const month = sourceColumn(dimension);
  const currentBucket = `${currentMonth}-01`;
  const previousBucket = `${previousMonth}-01`;
  predicates.push(sql`${month} in (${currentBucket}, ${previousBucket})`);
  const input = aggregateInput(metric, decimalMetricAlias, true);
  const aggregate = metricAggregate(metric, input);
  const valueFor = (bucket: string) => {
    const filter = sql`filter (where ${month} = ${bucket})`;
    const value = sql`${aggregate} ${filter}`;
    if (metric.statistic !== 'count') return value;
    // COUNT(input) is zero when rows exist but all inputs are null.
    return input
      ? sql`case when count(*) ${filter} > 0 then ${value} end`
      : sql`nullif(${value}, 0)`;
  };
  // Text preserves all digits of numeric and floating-point aggregate results at the driver
  // boundary. Convert the same values to numeric for subtraction and fractional division.
  return sql<Row>`
    select ${currentMonth}::text as "currentMonth", ${previousMonth}::text as "previousMonth",
      "current"::text as "current", "previous"::text as "previous",
      ("current"::text::numeric - "previous"::text::numeric)::text as "difference",
      (("current"::text::numeric - "previous"::text::numeric)
        / nullif("previous"::text::numeric, 0))::text as "changeRate"
    from (
      select ${valueFor(currentBucket)} as "current", ${valueFor(previousBucket)} as "previous"
      from (${source}) as ${sql.id('source')}
      where ${sql.join(predicates, sql` and `)}
    ) as ${sql.id('periods')}
  `.compile(db);
}

/** Compile over the already authorized and masked source projection, before its page. */
export const compileDataQueryComposition = (
  db: Kysely<V1TeableDatabase>,
  source: RawBuilder<unknown>,
  rootIdAlias: string,
  composition: BoundDataQueryComposition,
  decimalMetricAlias?: string
): { rows: CompiledQuery<Row>; count?: CompiledQuery<{ total: unknown }> } => {
  const { definition, filters, monthComparison } = composition;
  const metrics = definition.metrics ?? [];
  const grouped = metrics.length > 0;
  const groups = grouped ? (definition.groupBy ?? []) : [];
  // In comparison mode the output aliases describe the comparison row, not the source filters.
  const metricOutputs = definition.metricDimensions
    ? new Map(
        (monthComparison ? composition.sourceOutputs : composition.outputs).map((output) => [
          output.alias,
          output,
        ])
      )
    : undefined;
  const dimension = (alias: string) =>
    metricOutputs?.get(alias)?.cellValueType === 'dateTime'
      ? sql`date_trunc('milliseconds', ${sourceColumn(alias)})`
      : sourceColumn(alias);
  const fixedFilterCount = definition.filter?.length ?? 0;
  const predicates = filters.map(({ alias, operator, value }, index) => {
    // Owner predicates retain their saved semantics. Caller predicates compare displayed groups.
    if (metricOutputs && index >= fixedFilterCount) {
      const output = metricOutputs.get(alias);
      const key = dimension(alias);
      if (value === null) return sql`${key} is null`;
      if (output?.wireType === 'numberOrString') return sql`${key} = ${value}::numeric`;
      if (output?.cellValueType === 'dateTime') {
        return sql`extract(epoch from ${key}) * 1000 = ${value}::bigint`;
      }
      return sql`${key} = ${value}`;
    }
    const expression = sourceColumn(alias);
    switch (operator) {
      case 'isNull':
        return sql`${expression} is null`;
      case 'isNotNull':
        return sql`${expression} is not null`;
      case 'eq':
        return value === null ? sql`${expression} is null` : sql`${expression} = ${value}`;
      case 'ne':
        return value === null ? sql`${expression} is not null` : sql`${expression} <> ${value}`;
      case 'gt':
        return sql`${expression} > ${value}`;
      case 'gte':
        return sql`${expression} >= ${value}`;
      case 'lt':
        return sql`${expression} < ${value}`;
      case 'lte':
        return sql`${expression} <= ${value}`;
    }
  });
  if (monthComparison) {
    return {
      rows: compileMonthComparison(
        db,
        source,
        metrics[0],
        monthComparison,
        predicates,
        decimalMetricAlias
      ),
    };
  }
  const where = predicates.length ? sql`where ${sql.join(predicates, sql` and `)}` : sql``;
  const selections = grouped
    ? [
        ...(definition.metricDimensions ?? groups).map((alias) => {
          const value =
            definition.metricDimensions && !groups.includes(alias) ? sql`null` : dimension(alias);
          return sql`${value} as ${sql.id(alias)}`;
        }),
        ...metrics.map((metric) => {
          const aggregate = metricAggregate(
            metric,
            aggregateInput(metric, decimalMetricAlias, definition.metricDimensions !== undefined)
          );
          return sql`${aggregate} as ${sql.id(metric.alias)}`;
        }),
      ]
    : composition.outputs.map(({ alias }) => sql`${sourceColumn(alias)} as ${sql.id(alias)}`);
  const groupBy = groups.length ? sql`group by ${sql.join(groups.map(dimension))}` : sql``;
  const selected = sql`select ${sql.join(selections)} from (${source}) as ${sql.id('source')} ${where} ${groupBy}`;
  const orders = (definition.orderBy ?? []).map(({ alias, order }) =>
    order === 'asc' ? sql`${sql.id('result', alias)} asc` : sql`${sql.id('result', alias)} desc`
  );
  const orderedAliases = new Set((definition.orderBy ?? []).map(({ alias }) => alias));
  if (grouped) {
    for (const alias of groups) {
      if (!orderedAliases.has(alias)) orders.push(sql`${sql.id('result', alias)} asc`);
    }
  } else {
    // Keep the private row id outside the public projection without risking an alias collision.
    orders.push(sql`${sql.id('result', rootIdAlias)} asc`);
  }
  const page = definition.page;
  const groupLimit = sharedMetricGroupLimit(composition);
  const limit =
    groupLimit === undefined ? (page?.limit ?? defaultCompositionLimit) : groupLimit + 1;
  const offset = page?.offset ?? 0;
  const orderBy = orders.length ? sql`order by ${sql.join(orders)}` : sql``;
  // Records need the hidden id in the intermediate select, but never in the returned rows.
  const intermediate = grouped
    ? selected
    : sql`select ${sql.join([...selections, sql`${sourceColumn(rootIdAlias)} as ${sql.id(rootIdAlias)}`])} from (${source}) as ${sql.id('source')} ${where}`;
  const publicColumns = composition.outputs.map(({ alias }) => sql`${sql.id('result', alias)}`);
  const rows =
    sql<Row>`select ${sql.join(publicColumns)} from (${intermediate}) as ${sql.id('result')} ${orderBy} limit ${limit} offset ${offset}`.compile(
      db
    );
  return {
    rows,
    ...(page?.includeTotal
      ? {
          count: sql<{
            total: unknown;
          }>`select count(*) as ${sql.id('total')} from (${selected}) as ${sql.id('counted')}`.compile(
            db
          ),
        }
      : {}),
  };
};
