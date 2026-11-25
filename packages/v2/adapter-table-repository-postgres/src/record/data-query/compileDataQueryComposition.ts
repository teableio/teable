import type { BoundDataQueryComposition } from '@teable/v2-data-query';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type CompiledQuery, type Kysely, type RawBuilder } from 'kysely';

type Row = Record<string, unknown>;

const defaultCompositionLimit = 100;

export const sharedMetricGroupLimit = (composition?: BoundDataQueryComposition) => {
  const definition = composition?.definition;
  return definition?.metricDimensions && definition.groupBy?.length
    ? (definition.page?.limit ?? defaultCompositionLimit)
    : undefined;
};

/** Compile over the already authorized and masked source projection, before its page. */
export const compileDataQueryComposition = (
  db: Kysely<V1TeableDatabase>,
  source: RawBuilder<unknown>,
  rootIdAlias: string,
  composition: BoundDataQueryComposition
): { rows: CompiledQuery<Row>; count?: CompiledQuery<{ total: unknown }> } => {
  const { definition, filters } = composition;
  const metrics = definition.metrics ?? [];
  const grouped = metrics.length > 0;
  const groups = grouped ? (definition.groupBy ?? []) : [];
  const column = (alias: string) => sql`${sql.id('source', alias)}`;
  const metricOutputs = definition.metricDimensions
    ? new Map(composition.outputs.map((output) => [output.alias, output]))
    : undefined;
  const dimension = (alias: string) =>
    metricOutputs?.get(alias)?.cellValueType === 'dateTime'
      ? sql`date_trunc('milliseconds', ${column(alias)})`
      : column(alias);
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
    const expression = column(alias);
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
  const where = predicates.length ? sql`where ${sql.join(predicates, sql` and `)}` : sql``;
  const selections = grouped
    ? [
        ...(definition.metricDimensions ?? groups).map((alias) => {
          const value =
            definition.metricDimensions && !groups.includes(alias) ? sql`null` : dimension(alias);
          return sql`${value} as ${sql.id(alias)}`;
        }),
        ...metrics.map((metric) => {
          const input = metric.input === undefined ? undefined : column(metric.input);
          let expression: RawBuilder<unknown>;
          switch (metric.statistic) {
            case 'count':
              expression = input ? sql`count(${input})` : sql`count(*)`;
              break;
            case 'sum':
              expression = sql`sum(${input!})`;
              break;
            case 'average':
              expression = sql`avg(${input!})`;
              break;
            case 'min':
              expression = sql`min(${input!})`;
              break;
            case 'max':
              expression = sql`max(${input!})`;
              break;
          }
          return sql`${expression} as ${sql.id(metric.alias)}`;
        }),
      ]
    : composition.outputs.map(({ alias }) => sql`${column(alias)} as ${sql.id(alias)}`);
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
    : sql`select ${sql.join([...selections, sql`${column(rootIdAlias)} as ${sql.id(rootIdAlias)}`])} from (${source}) as ${sql.id('source')} ${where}`;
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
