import {
  buildRecordConditionSpec,
  domainError,
  getFormulaSourceBudget,
  replaceCurrentUserTagInFilter,
  type DomainError,
  type Field,
  type IExecutionContext,
  type LastModifiedByField,
  type ITableReadModel,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import {
  assertDataQueryAccess,
  dataQueryAccessForSource,
  bindDataQueryExpressionLegacyFilter,
  DataQueryBinding,
  isBoundDataQuery,
  traceDataQueryStage,
  validateDataQueryFilter,
  type BoundDataQuery,
  type BoundDataQueryFormulaExpression,
  type BoundDataQueryPredicate,
  type DataQueryBucket,
  type DataQueryRelationAggregate,
  type DataQueryRelationLinkStorage,
  type DataQueryRelationPlan,
  type DataQueryResult,
  type DataQuerySystemField,
  type IDataQueryExecutor,
} from '@teable/v2-data-query';
import {
  Pg16TypeValidationStrategy,
  defaultFormulaCompileBudgetConfig,
  type FormulaCompileBudgetConfig,
  type IPgTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  sql,
  type CompiledQuery,
  type Expression,
  type Kysely,
  type RawBuilder,
  type SqlBool,
} from 'kysely';
import { err, ok, safeTry, type Result } from 'neverthrow';

import { buildDateLikeGroupExpression } from '../query-builder/dateLikeOrderBy';
import { maskValueExpression } from '../query-builder/maskValueExpression';
import { buildStoredFieldOrderByClauses, StoredFieldSelectVisitor } from '../query-builder/stored';
import {
  buildUserGroupIdentityExpr,
  buildUserJsonObjectFromSnapshotExpr,
  resolveUserGroupIdentityMultiplicity,
} from '../query-builder/userSnapshotSql';
import { buildFieldMaskSqlMap } from '../repository/buildFieldMaskSql';
import { buildRecordWhereClause } from '../repository/buildRecordWhereClause';
import { buildTableRecordAggregationExpression } from '../repository/TableRecordAggregationSql';
import {
  compileDataQueryPredicate,
  compileDataQueryHavingExpression,
  compileDataQueryFormulaExpression,
  type DataQueryExpressionSqlContext,
} from './compileDataQueryExpression';
import { compileDistinctRecords } from './compileDistinctRecords';
import { dataQueryExecutionError } from './dataQueryExecutionError';
import { normalizeDataQueryValue } from './normalizeDataQueryValue';

type Row = Record<string, unknown>;

const systemColumns: Readonly<Record<DataQuerySystemField, string>> = {
  id: '__id',
  createdTime: '__created_time',
  lastModifiedTime: '__last_modified_time',
  autoNumber: '__auto_number',
  version: '__version',
};

const failure = (code: string, message: string): DomainError =>
  domainError.validation({ code: `data_query.${code}`, message });

type ExpressionSqlSource = {
  readonly table: ITableReadModel;
  readonly scope: RecordQueryPluginScope;
  readonly sqlAlias: string;
  readonly fields: ReadonlyMap<string, Field>;
  readonly values: ReadonlyMap<string, RawBuilder<unknown>>;
  readonly masks?: ReadonlyMap<string, Expression<SqlBool>>;
};

const expressionSqlContext = (
  context: IExecutionContext,
  query: BoundDataQuery,
  sources: ReadonlyMap<string, ExpressionSqlSource>,
  typeValidationStrategy: IPgTypeValidationStrategy,
  formulaCompileBudget: FormulaCompileBudgetConfig
): DataQueryExpressionSqlContext => ({
  typeValidationStrategy,
  formulaCompileBudget,
  resolveFormulaField: (source, fieldId) => {
    const binding = sources.get(source);
    const value = binding?.values.get(fieldId);
    const field = binding?.fields.get(fieldId);
    if (!binding || !value || !field)
      return err(failure('expression_compile', 'A formula field reference is not bound'));
    const mask = binding.masks?.get(fieldId);
    const type = field.type().toString();
    const actorColumn =
      type === 'createdBy'
        ? '__created_by'
        : type === 'lastModifiedBy' && (field as LastModifiedByField).isTrackAll()
          ? '__last_modified_by'
          : undefined;
    const actorFallback = actorColumn ? sql`${sql.id(binding.sqlAlias, actorColumn)}` : undefined;
    return ok({
      field,
      value,
      ...(actorFallback
        ? { actorIdFallback: mask ? maskValueExpression(mask, actorFallback) : actorFallback }
        : {}),
    });
  },
  resolveRowAlias: (source) => {
    const binding = sources.get(source);
    return binding
      ? ok(binding.sqlAlias)
      : err(failure('expression_compile', 'An expression source is not bound'));
  },
  resolveSystem: (source, system) => {
    const binding = sources.get(source);
    return binding
      ? ok(sql`${sql.id(binding.sqlAlias, systemColumns[system])}`)
      : err(failure('expression_compile', 'An expression source is not bound'));
  },
  resolveParameter: (name) =>
    query.expressionParameters && Object.hasOwn(query.expressionParameters, name)
      ? ok(query.expressionParameters[name])
      : err(failure('missing_parameter', 'An expression parameter is missing')),
  compileLegacyFilter: (source, filter) =>
    safeTry(function* () {
      const binding = sources.get(source);
      if (!binding) return err(failure('expression_compile', 'An expression source is not bound'));
      const bound = yield* bindDataQueryExpressionLegacyFilter(
        filter,
        query.expressionParameters ?? {}
      );
      const resolved = replaceCurrentUserTagInFilter(
        binding.table,
        bound,
        context.actorId.toString()
      );
      yield* validateDataQueryFilter(binding.table, resolved);
      if (resolved == null) return ok(undefined);
      const condition = yield* buildRecordConditionSpec(
        binding.table,
        resolved,
        binding.scope.fieldMasks
      );
      const where = yield* buildRecordWhereClause(condition, { tableAlias: binding.sqlAlias });
      return ok(where ? sql`${where}` : undefined);
    }),
});
/**
 * Compile one of the controlled bucket shapes. Labels are bound values, never
 * interpolated SQL; the stored expression is already masked before it arrives.
 */
const buildBucketExpression = (
  expression: RawBuilder<unknown>,
  bucket: DataQueryBucket,
  dateOnly = false
): RawBuilder<unknown> => {
  if (bucket.kind === 'dateTrunc') {
    // A date-only column is a calendar date: never reinterpret it through the
    // session timezone. A timestamp is an instant and converts through the zone.
    return dateOnly
      ? sql`to_char(date_trunc(${bucket.unit}, ${expression}::timestamp), 'YYYY-MM-DD')`
      : sql`to_char(date_trunc(${bucket.unit}, ${expression}::timestamptz at time zone ${bucket.timeZone}), 'YYYY-MM-DD')`;
  }
  const nullLabel = bucket.nullLabel === undefined ? sql`null` : sql`${bucket.nullLabel}`;
  let measured: RawBuilder<unknown>;
  if (bucket.kind === 'numericRange') {
    measured = expression;
  } else {
    const valueDate = dateOnly
      ? sql`(${expression})::date`
      : sql`(${expression}::timestamptz at time zone ${bucket.timeZone})::date`;
    const anchorDate =
      bucket.anchor === undefined
        ? dateOnly
          ? sql`(now() at time zone ${bucket.timeZone})::date`
          : sql`(now() at time zone ${bucket.timeZone})::date`
        : sql`${bucket.anchor}::date`;
    measured =
      bucket.unit === 'day'
        ? sql`(${anchorDate} - ${valueDate})`
        : sql`((extract(year from age(${anchorDate}, ${valueDate})) * 12 + extract(month from age(${anchorDate}, ${valueDate})))::integer)`;
  }
  const cases = bucket.edges.map(
    (edge) => sql`when ${measured} < ${edge.maxExclusive} then ${edge.label}`
  );
  return sql`case when ${expression} is null then ${nullLabel} ${sql.join(
    cases,
    sql` `
  )} else ${bucket.fallbackLabel} end`;
};
/**
 * PostgreSQL-side de-duplication for multi-value lookup/rollup storage.
 * First occurrence wins, NULL/scalars pass through unchanged, and elements compare
 * by their stored JSON shape so an identical object collapses while a distinct one stays.
 */
const buildArrayDistinctExpression = (
  expression: RawBuilder<unknown>
): RawBuilder<unknown> => sql`case
  when ${expression} is null then null
  when jsonb_typeof(${expression}::jsonb) = 'array' then coalesce((
    select jsonb_agg(deduped.element order by deduped.first_position)
    from (
      select item.element, min(item.ord) as first_position
      from jsonb_array_elements(${expression}::jsonb) with ordinality as item(element, ord)
      group by item.element
    ) as deduped
  ), '[]'::jsonb)
  else ${expression}
end`;

/** pg returns count(*) as a string; never let an unsafe total silently round. */
const parseTotal = (value: unknown): number | undefined => {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (typeof value === 'bigint')
    return value >= BigInt(0) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : undefined;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
};

/** Compiles stored-value reads only. No query plans, scopes or caller values are cached. */
export class PostgresDataQueryExecutor implements IDataQueryExecutor {
  private readonly statementTimeoutMs: number;
  private readonly typeValidationStrategy: IPgTypeValidationStrategy;
  private readonly formulaCompileBudget: FormulaCompileBudgetConfig;

  constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    options: {
      statementTimeoutMs?: number;
      typeValidationStrategy?: IPgTypeValidationStrategy;
      formulaCompileBudget?: FormulaCompileBudgetConfig;
    } = {}
  ) {
    const timeout = options.statementTimeoutMs ?? 4000;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 60_000) {
      throw new RangeError(
        'Data query statement timeout must be positive and no greater than 60000'
      );
    }
    this.statementTimeoutMs = Math.ceil(timeout);
    this.typeValidationStrategy =
      options.typeValidationStrategy ?? new Pg16TypeValidationStrategy();
    this.formulaCompileBudget = options.formulaCompileBudget ?? defaultFormulaCompileBudgetConfig;
  }

  private prepareBinding(
    context: IExecutionContext,
    table: ITableReadModel,
    query: BoundDataQuery,
    binding?: DataQueryBinding
  ): Result<DataQueryBinding, DomainError> {
    return binding
      ? ok(binding)
      : DataQueryBinding.prepare(query.validatedDefinition, table, {
          formulaSourceBudget: getFormulaSourceBudget(context),
        });
  }

  /** Diagnostic output only: execute never accepts a compiled statement. */
  compile(
    context: IExecutionContext,
    table: ITableReadModel,
    query: BoundDataQuery,
    scope: RecordQueryPluginScope,
    binding?: DataQueryBinding
  ): Result<CompiledQuery<Row>, DomainError> {
    const prepared = this.prepareBinding(context, table, query, binding);
    if (prepared.isErr()) return err(prepared.error);
    return this.buildQueries(context, table, query, scope, prepared.value).map(
      (queries) => queries.rows
    );
  }

  private buildQueries(
    context: IExecutionContext,
    table: ITableReadModel,
    query: BoundDataQuery,
    scope: RecordQueryPluginScope,
    binding: DataQueryBinding
  ): Result<
    {
      rows: CompiledQuery<Row>;
      count?: CompiledQuery<{ total: unknown }>;
      constantTotal?: number;
    },
    DomainError
  > {
    try {
      const db = this.db;
      const typeValidationStrategy = this.typeValidationStrategy;
      const formulaCompileBudget = this.formulaCompileBudget;
      return safeTry(function* () {
        if (!isBoundDataQuery(query)) {
          return err(failure('invalid_bound_query', 'Query must be bound by DataQueryDefinition'));
        }
        const plan = binding.plan;
        yield* assertDataQueryAccess(plan, scope);
        yield* validateDataQueryFilter(table, query.filter);
        if (
          !Number.isInteger(query.limit) ||
          query.limit < 1 ||
          query.limit > 1000 ||
          !Number.isSafeInteger(query.offset) ||
          query.offset < 0
        ) {
          return err(failure('invalid_bound_query', 'Invalid bound query page'));
        }
        const tableName = plan.root.physical;
        const fields = new Map<string, Field>();
        const columns = new Map<string, string>();
        for (const planned of plan.root.fields) {
          const field = yield* table.getField(
            (candidate) => candidate.id().toString() === planned.fieldId
          );
          if (planned.column === null) {
            return err(failure('field_physical', 'A query field has no physical column'));
          }
          fields.set(planned.fieldId, field);
          columns.set(planned.fieldId, planned.column);
        }
        const maskIds = new Set<string>();
        for (const mask of scope.fieldMasks ?? []) {
          if (maskIds.has(mask.fieldId)) {
            return err(failure('invalid_scope', 'Duplicate field masks are not supported'));
          }
          maskIds.add(mask.fieldId);
        }
        const masks = yield* buildFieldMaskSqlMap(scope.fieldMasks, 't');
        const predicates: RawBuilder<unknown>[] = [];
        if (query.recordId !== undefined) {
          predicates.push(sql`${sql.id('t', '__id')} = ${query.recordId}`);
        }
        const filter = replaceCurrentUserTagInFilter(
          table,
          query.filter,
          context.actorId.toString()
        );
        if (plan.definitionVersion < 3 && filter != null) {
          const condition = yield* buildRecordConditionSpec(table, filter, scope.fieldMasks);
          const where = yield* buildRecordWhereClause(condition, { tableAlias: 't' });
          if (where) predicates.push(sql`${where}`);
        }
        // A direct adapter caller cannot use skipRecordSpec to remove an already-merged scope.
        let expressionScope: RawBuilder<unknown> | undefined;
        if (scope.recordSpec) {
          const where = yield* buildRecordWhereClause(scope.recordSpec, { tableAlias: 't' });
          if (where) expressionScope = sql`${where}`;
          if (where) predicates.push(sql`${where}`);
        }
        const from = tableName.schema
          ? sql`${sql.id(tableName.schema, tableName.tableName)} as ${sql.id('t')}`
          : sql`${sql.id(tableName.tableName)} as ${sql.id('t')}`;
        const visitor = new StoredFieldSelectVisitor('t');
        const values = new Map<string, RawBuilder<unknown>>();
        for (const [id, field] of fields) {
          const selected = yield* field.accept(visitor);
          const expression = sql`${selected.expression}`;
          const mask = masks?.get(id);
          values.set(id, mask ? maskValueExpression(mask, expression) : expression);
        }
        const expressionContext = expressionSqlContext(
          context,
          query,
          new Map([['root', { table, scope, sqlAlias: 't', fields, values, masks }]]),
          typeValidationStrategy,
          formulaCompileBudget
        );
        if (plan.predicate) {
          const predicate = yield* compileDataQueryPredicate(plan.predicate, expressionContext);
          if (predicate)
            predicates.push(
              expressionScope
                ? sql`(case when ${expressionScope} then ${predicate} else false end)`
                : predicate
            );
        }
        const where = predicates.length ? sql`where ${sql.join(predicates, sql` and `)}` : sql``;
        const orders: RawBuilder<unknown>[] = [];
        const addOrder = (
          expression: RawBuilder<unknown>,
          direction: 'asc' | 'desc',
          matchNulls = false,
          nulls?: 'first' | 'last'
        ) => {
          const nullOrder =
            nulls ?? (matchNulls ? (direction === 'asc' ? 'first' : 'last') : undefined);
          orders.push(
            direction === 'asc'
              ? nullOrder === 'first'
                ? sql`${expression} asc nulls first`
                : nullOrder === 'last'
                  ? sql`${expression} asc nulls last`
                  : sql`${expression} asc`
              : nullOrder === 'first'
                ? sql`${expression} desc nulls first`
                : nullOrder === 'last'
                  ? sql`${expression} desc nulls last`
                  : sql`${expression} desc`
          );
        };
        if (plan.kind === 'records') {
          if (plan.projections.some((projection) => projection.kind === 'aggregate')) {
            return err(
              failure('join_version', 'Relation aggregates require a relation execution plan')
            );
          }
          // Keep native outputs for DATE ordering; other aliases sort by their
          // selected labels without expanding expensive expressions a second time.
          const outputValues = new Map<string, RawBuilder<unknown>>();
          for (const projection of plan.projections) {
            if (projection.kind === 'expression') {
              outputValues.set(
                projection.alias,
                yield* compileDataQueryFormulaExpression(
                  projection.expression,
                  expressionContext,
                  'display'
                )
              );
              continue;
            }
            if (projection.kind === 'system') {
              outputValues.set(projection.alias, sql.id('t', projection.column));
              continue;
            }
            if (projection.kind !== 'field' || projection.column === null)
              throw new Error('Missing field projection');
            const stored = values.get(projection.fieldId)!;
            const expression =
              projection.bucket !== undefined
                ? // Teable stores every date cell as an instant (timestamptz), even
                  // when the view formats it as a date; convert through the declared zone.
                  buildBucketExpression(stored, projection.bucket)
                : stored;
            outputValues.set(
              projection.alias,
              projection.arrayDistinct === true
                ? buildArrayDistinctExpression(expression)
                : expression
            );
          }
          const selections = plan.projections.map((projection) => {
            const value = outputValues.get(projection.alias)!;
            return sql`${value} as ${sql.id(projection.alias)}`;
          });
          if (plan.resultGrain === 'distinctTuple') {
            return ok(
              compileDistinctRecords(
                db,
                sql`select ${sql.join(selections)} from ${from} ${where}`,
                plan,
                query,
                typeValidationStrategy
              )
            );
          }
          for (const sort of query.sort) {
            if ('alias' in sort) {
              const value = outputValues.get(sort.alias);
              if (!value) {
                return err(failure('invalid_sort', 'A sort alias is not a selected query output'));
              }
              addOrder(sql.id(sort.alias), sort.order, true, sort.nulls);
              continue;
            }
            if ('system' in sort) {
              addOrder(sql.id('t', systemColumns[sort.system]), sort.order, true, sort.nulls);
              continue;
            }
            if (!('fieldId' in sort)) {
              return err(
                failure('invalid_sort', 'Records sorting requires a field or system target')
              );
            }
            const field = fields.get(sort.fieldId);
            const column = columns.get(sort.fieldId);
            const value = values.get(sort.fieldId);
            if (!field || !column || !value) {
              return err(failure('invalid_sort', 'A sort field is not part of the query binding'));
            }
            const clauses = yield* buildStoredFieldOrderByClauses(field, column, sort.order, 't', {
              columnExpression: value,
            });
            clauses.forEach((clause, index) =>
              addOrder(
                clause.expression,
                clause.direction,
                clause.matchV1Nulls,
                index === 0 ? sort.nulls : undefined
              )
            );
          }
          addOrder(sql.id('t', '__id'), 'asc');
          const rows = sql<Row>`select ${sql.join(selections)} from ${from} ${where}
            order by ${sql.join(orders)} limit ${query.limit} offset ${query.offset}`.compile(db);
          return ok({
            rows,
            ...(query.includeTotal
              ? {
                  count: sql<{
                    total: unknown;
                  }>`select count(*) as ${sql.id('total')} from ${from} ${where}`.compile(db),
                }
              : {}),
          });
        }

        const rootAggregates = plan.aggregates;
        for (const aggregate of rootAggregates) {
          if (aggregate.source !== 'root') {
            return err(
              failure('invalid_relation_plan', 'A relation metric requires the relation executor')
            );
          }
          if (!aggregate.expression && aggregate.fieldId === undefined) {
            return err(failure('invalid_relation_plan', 'A root aggregate requires an input'));
          }
        }
        const sourceIds = [
          ...new Set([
            ...rootAggregates.flatMap((aggregate) =>
              aggregate.fieldId ? [aggregate.fieldId] : []
            ),
            ...plan.groupBy.map((group) => group.fieldId),
          ]),
        ];
        // Field projections used by aggregates/groups, plus a private column for each
        // bucketed group. Computing the bucket here keeps its bound values out of
        // GROUP BY and out of the public alias namespace entirely.
        const sourceExpressions = new Map<string, RawBuilder<unknown>>();
        const sourceSelections: RawBuilder<unknown>[] = sourceIds.map((id) => {
          const field = fields.get(id)!;
          const value = values.get(id)!;
          // Historical system-user columns store a plain user ID, not JSON. Normalize
          // after masking, without a fallback that could reveal a masked identity.
          const fieldType = field.type().toString();
          const expression =
            fieldType === 'createdBy' || fieldType === 'lastModifiedBy'
              ? buildUserJsonObjectFromSnapshotExpr(value)
              : value;
          sourceExpressions.set(id, expression);
          return sql`${expression} as ${sql.id(id)}`;
        });
        const metricColumns = new Map<string, string>();
        const metricFilters = new Map<string, string>();
        for (const [index, metric] of rootAggregates.entries()) {
          const predicate = metric.filter
            ? yield* compileDataQueryPredicate(metric.filter, expressionContext)
            : undefined;
          const allowed =
            predicate && expressionScope
              ? sql`case when ${expressionScope} then ${predicate} else false end`
              : (predicate ?? expressionScope);
          if (metric.expression) {
            const column = `__metric_${index}`;
            const compiled = yield* compileDataQueryFormulaExpression(
              metric.expression,
              expressionContext
            );
            metricColumns.set(metric.alias, column);
            sourceSelections.push(
              sql`${allowed ? sql`case when ${allowed} then ${compiled} else null end` : compiled} as ${sql.id(column)}`
            );
          }
          if (metric.filter) {
            const column = `__metric_filter_${index}`;
            metricFilters.set(metric.alias, column);
            sourceSelections.push(sql`${allowed ?? sql`true`} as ${sql.id(column)}`);
          }
        }
        const bucketColumns = new Map<string, string>();
        for (const [index, group] of plan.groupBy.entries()) {
          const bucket = group.bucket;
          if (bucket === undefined) continue;
          const privateName = `__bucket_${index}`;
          bucketColumns.set(group.alias, privateName);
          sourceSelections.push(
            sql`${buildBucketExpression(
              sourceExpressions.get(group.fieldId)!,
              bucket
            )} as ${sql.id(privateName)}`
          );
        }
        const source = sql`select ${sql.join(sourceSelections)} from ${from} ${where} ${metricColumns.size || metricFilters.size ? sql`offset 0` : sql``}`;
        const selections = rootAggregates.map((aggregate) => {
          const column = metricColumns.get(aggregate.alias) ?? aggregate.fieldId!;
          const filter = metricFilters.get(aggregate.alias);
          const value = buildTableRecordAggregationExpression(
            sql.id('a', column),
            aggregate.statisticFunc,
            aggregate.expression ? undefined : fields.get(aggregate.fieldId!),
            filter ? sql.id('a', filter) : undefined
          );
          return sql`${value} as ${sql.id(aggregate.alias)}`;
        });
        const groups = new Map<string, RawBuilder<unknown>>();
        const bucketGroupAliases = new Set<string>();
        for (const group of plan.groupBy) {
          const field = fields.get(group.fieldId)!;
          const column = sql.ref(`a.${group.fieldId}`);
          const bucketColumn = bucketColumns.get(group.alias);
          let expression: RawBuilder<unknown>;
          if (bucketColumn !== undefined) {
            // A private column has no bind values and cannot shadow an input name.
            expression = sql.ref(`a.${bucketColumn}`);
            bucketGroupAliases.add(group.alias);
          } else {
            const multiplicity = yield* resolveUserGroupIdentityMultiplicity(field);
            expression =
              multiplicity == null
                ? (buildDateLikeGroupExpression(field, 'a', group.fieldId) ?? column)
                : buildUserGroupIdentityExpr(column, multiplicity);
          }
          groups.set(`group:${group.alias}`, expression);
          selections.push(sql`${expression} as ${sql.id(group.alias)}`);
        }
        const groupOrders = [...query.sort];
        const orderedIds = new Set(
          groupOrders.flatMap((sort) => {
            if ('fieldId' in sort) return [sort.fieldId];
            if ('alias' in sort) {
              const group = plan.groupBy.find((candidate) => candidate.alias === sort.alias);
              return group ? [group.fieldId] : [];
            }
            return [];
          })
        );
        for (const group of plan.groupBy) {
          if (orderedIds.has(group.fieldId)) continue;
          groupOrders.push(
            bucketGroupAliases.has(group.alias)
              ? { alias: group.alias, order: 'asc' }
              : { fieldId: group.fieldId, order: 'asc' }
          );
        }
        for (const sort of groupOrders) {
          if ('alias' in sort) {
            const bucketExpression = bucketGroupAliases.has(sort.alias)
              ? groups.get(`group:${sort.alias}`)
              : undefined;
            // A bucket alias may equal an input column; use its private expression.
            addOrder(bucketExpression ?? sql.id(sort.alias), sort.order, true, sort.nulls);
            continue;
          }
          const group =
            'fieldId' in sort
              ? plan.groupBy.find(
                  (candidate) =>
                    candidate.fieldId === sort.fieldId && candidate.bucket === undefined
                )
              : undefined;
          const expression = group === undefined ? undefined : groups.get(`group:${group.alias}`);
          if (!('fieldId' in sort) || group === undefined || expression === undefined) {
            return err(
              failure('invalid_sort', 'Aggregate sorting requires a group field or alias')
            );
          }
          const clauses = yield* buildStoredFieldOrderByClauses(
            fields.get(sort.fieldId)!,
            sort.fieldId,
            sort.order,
            'a',
            { columnExpression: expression, groupIdentityCollation: true }
          );
          clauses.forEach((clause, index) =>
            addOrder(
              clause.expression,
              clause.direction,
              clause.matchV1Nulls,
              index === 0 ? sort.nulls : undefined
            )
          );
          // Display ordering may have ties (select-choice order or link titles).
          addOrder(expression, sort.order, true, sort.nulls);
        }
        const groupClause = groups.size ? sql`group by ${sql.join([...groups.values()])}` : sql``;
        const orderClause = orders.length ? sql`order by ${sql.join(orders)}` : sql``;
        // The bucket expressions live in the source subquery, so every GROUP BY
        // reference is a plain column: no bind duplication and no alias shadowing.
        const combined = sql`select ${sql.join(selections)} from (${source}) as ${sql.id('a')} ${groupClause}`;
        if (plan.having) {
          const predicate = yield* compileDataQueryHavingExpression(
            plan.having,
            expressionContext,
            'aggregate_outputs'
          );
          const filtered = sql`select * from (${combined}) as ${sql.id('aggregate_outputs')} where ${predicate}`;
          orders.length = 0;
          for (const sort of groupOrders) {
            if ('alias' in sort) {
              addOrder(sql.id('aggregate_outputs', sort.alias), sort.order, true, sort.nulls);
              continue;
            }
            const group = plan.groupBy.find(
              (candidate) =>
                'fieldId' in sort && candidate.fieldId === sort.fieldId && !candidate.bucket
            );
            if (!group || !('fieldId' in sort)) throw new Error('Missing aggregate sort output');
            const expression = sql`${sql.id('aggregate_outputs', group.alias)}`;
            const clauses = yield* buildStoredFieldOrderByClauses(
              fields.get(sort.fieldId)!,
              group.alias,
              sort.order,
              'aggregate_outputs',
              { columnExpression: expression, groupIdentityCollation: true }
            );
            clauses.forEach((clause, index) =>
              addOrder(
                clause.expression,
                clause.direction,
                clause.matchV1Nulls,
                index === 0 ? sort.nulls : undefined
              )
            );
            addOrder(expression, sort.order, true, sort.nulls);
          }
          const rows =
            sql<Row>`${filtered} ${orders.length ? sql`order by ${sql.join(orders)}` : sql``} limit ${query.limit} offset ${query.offset}`.compile(
              db
            );
          return ok({
            rows,
            ...(query.includeTotal
              ? {
                  count: sql<{
                    total: unknown;
                  }>`select count(*) as ${sql.id('total')} from (${filtered}) as ${sql.id('counted')}`.compile(
                    db
                  ),
                }
              : {}),
          });
        }
        const rows =
          sql<Row>`${combined} ${orderClause} limit ${query.limit} offset ${query.offset}`.compile(
            db
          );
        if (!query.includeTotal) return ok({ rows });
        // Without grouping the aggregate always produces exactly one result row.
        if (!groups.size) return ok({ rows, constantTotal: 1 });
        const count = sql<{
          total: unknown;
        }>`select count(*) as ${sql.id('total')} from (
          select 1 from (${source}) as ${sql.id('a')} ${groupClause}
        ) as ${sql.id('g')}`.compile(db);
        return ok({ rows, count });
      });
    } catch {
      return err(failure('compile_failed', 'Unable to compile data query'));
    }
  }
  async compileRelation(
    context: IExecutionContext,
    plan: DataQueryRelationPlan
  ): Promise<
    Result<
      {
        rows: CompiledQuery<Row>;
        count?: CompiledQuery<{ total: unknown }>;
        constantTotal?: number;
      },
      DomainError
    >
  > {
    return traceDataQueryStage(
      context,
      'compile.relation',
      { 'teable.component': 'repository' },
      async () => this.buildRelationQueries(context, plan)
    );
  }

  private buildRelationQueries(
    context: IExecutionContext,
    plan: DataQueryRelationPlan
  ): Result<
    {
      rows: CompiledQuery<Row>;
      count?: CompiledQuery<{ total: unknown }>;
      /** An ungrouped aggregate returns exactly one row. */
      constantTotal?: number;
    },
    DomainError
  > {
    try {
      const db = this.db;
      const typeValidationStrategy = this.typeValidationStrategy;
      const formulaCompileBudget = this.formulaCompileBudget;
      return safeTry(function* () {
        if (!isBoundDataQuery(plan.query)) {
          return err(failure('invalid_bound_query', 'Query must be bound by DataQueryDefinition'));
        }
        const boundPlan = plan.plan;
        if (boundPlan.kind !== 'records' && boundPlan.kind !== 'aggregate') {
          return err(
            failure('invalid_relation_plan', 'Relation execution requires records or aggregate')
          );
        }
        const sourcePlans = new Map(plan.sources.map((source) => [source.alias, source]));
        if (sourcePlans.size !== boundPlan.sources.length) {
          return err(failure('invalid_relation_plan', 'Relation plan is incomplete'));
        }
        // Public relation aliases are arbitrary strings (long, dotted, unicode). They are
        // never SQL identifiers: a private per-source alias keeps PostgreSQL identifier
        // limits and quoting rules out of the public contract.
        const sqlAliases = new Map(
          boundPlan.sources.map((source, index) => [source.alias, `relation_${index}`])
        );
        yield* assertDataQueryAccess(dataQueryAccessForSource(boundPlan, 'root'), plan.rootScope);
        for (const source of boundPlan.sources) {
          const sourcePlan = sourcePlans.get(source.alias);
          if (!sourcePlan) {
            return err(failure('invalid_relation_plan', 'A relation scope is missing'));
          }
          yield* assertDataQueryAccess(
            dataQueryAccessForSource(boundPlan, source.alias),
            sourcePlan.scope
          );
        }
        yield* validateDataQueryFilter(plan.rootTable, plan.query.filter);
        const rootName = boundPlan.root.physical;
        // `root` is reserved for the public root source, so a declared relation alias
        // can never shadow the internal root alias.
        const rootAlias = 'root';
        const rootFrom = rootName.schema
          ? sql`${sql.id(rootName.schema, rootName.tableName)} as ${sql.id(rootAlias)}`
          : sql`${sql.id(rootName.tableName)} as ${sql.id(rootAlias)}`;

        const rootFields = new Map<string, Field>();
        const rootColumns = new Map<string, string>();
        for (const planned of boundPlan.root.fields) {
          const field = yield* plan.rootTable.getField(
            (candidate) => candidate.id().toString() === planned.fieldId
          );
          if (planned.column === null) {
            return err(failure('field_physical', 'A query field has no physical column'));
          }
          rootFields.set(planned.fieldId, field);
          rootColumns.set(planned.fieldId, planned.column);
        }
        const rootMasks = yield* buildFieldMaskSqlMap(plan.rootScope.fieldMasks, rootAlias);
        const rootVisitor = new StoredFieldSelectVisitor(rootAlias);
        const rootValues = new Map<string, RawBuilder<unknown>>();
        for (const [id, field] of rootFields) {
          const selected = yield* field.accept(rootVisitor);
          const expression = sql`${selected.expression}`;
          const mask = rootMasks?.get(id);
          rootValues.set(id, mask ? maskValueExpression(mask, expression) : expression);
        }
        const expressionSources = new Map<string, ExpressionSqlSource>();
        expressionSources.set('root', {
          table: plan.rootTable,
          scope: plan.rootScope,
          sqlAlias: rootAlias,
          fields: rootFields,
          values: rootValues,
          masks: rootMasks,
        });
        const expressionContext = expressionSqlContext(
          context,
          plan.query,
          expressionSources,
          typeValidationStrategy,
          formulaCompileBudget
        );
        const rootVisibility = plan.rootScope.recordSpec
          ? yield* buildRecordWhereClause(plan.rootScope.recordSpec, { tableAlias: rootAlias })
          : undefined;
        const expressionScope = rootVisibility ? sql`${rootVisibility}` : undefined;

        type BoundMetric = {
          readonly source: string;
          readonly alias: string;
          readonly statisticFunc: DataQueryRelationAggregate['statisticFunc'];
          readonly fieldId?: string;
          readonly column: string | null;
          readonly expression?: BoundDataQueryFormulaExpression;
          readonly filter?: BoundDataQueryPredicate;
        };
        const relationMetrics = (
          boundPlan.kind === 'records'
            ? boundPlan.projections.filter((projection) => projection.kind === 'aggregate')
            : boundPlan.aggregates.filter((aggregate) => aggregate.source !== 'root')
        ) as BoundMetric[];
        // Group-level averages need both components per root; the hidden column
        // names are index-based so a long public alias cannot exceed PG limits.
        const metricOrder = new Map(
          relationMetrics.map((metric, index) => [metric.alias, index] as const)
        );
        const metricValueAlias = (metric: BoundMetric): string =>
          `metric_${metricOrder.get(metric.alias)}_value`;
        const metricSumAlias = (metric: BoundMetric): string =>
          `metric_${metricOrder.get(metric.alias)}_sum`;
        const metricCountAlias = (metric: BoundMetric): string =>
          `metric_${metricOrder.get(metric.alias)}_count`;
        const metricsBySource = new Map<string, BoundMetric[]>();
        for (const metric of relationMetrics) {
          const metrics = metricsBySource.get(metric.source) ?? [];
          metrics.push(metric);
          metricsBySource.set(metric.source, metrics);
        }
        const grouped = boundPlan.kind === 'aggregate';

        type SqlSource = {
          readonly alias: string;
          readonly cardinality: 'one' | 'many';
          readonly sqlAlias: string;
          readonly from: RawBuilder<unknown>;
          readonly parentAlias: string;
          readonly linkFieldId: string;
          readonly linkStorage: DataQueryRelationLinkStorage;
          readonly fields: Map<string, Field>;
          readonly columns: Map<string, string>;
          readonly values: Map<string, RawBuilder<unknown>>;
          /** Parent-scoped mask expressions; a child hop ANDs its link-edge mask. */
          readonly masks?: ReadonlyMap<string, Expression<SqlBool>>;
          /** Link-edge mask, declared filter and row scope, all bound to this alias. */
          readonly restrictions: RawBuilder<unknown>[];
          readonly visibility: readonly RawBuilder<unknown>[];
        };
        const sqlSources: SqlSource[] = [];
        for (const source of boundPlan.sources) {
          const sourcePlan = sourcePlans.get(source.alias)!;
          const sqlAlias = sqlAliases.get(source.alias)!;
          const name = source.physical;
          const from = name.schema
            ? sql`${sql.id(name.schema, name.tableName)} as ${sql.id(sqlAlias)}`
            : sql`${sql.id(name.tableName)} as ${sql.id(sqlAlias)}`;
          const fields = new Map<string, Field>();
          const columns = new Map<string, string>();
          for (const planned of source.fields) {
            const field = yield* sourcePlan.table.getField(
              (candidate) => candidate.id().toString() === planned.fieldId
            );
            if (planned.column === null) {
              return err(failure('field_physical', 'A query field has no physical column'));
            }
            fields.set(planned.fieldId, field);
            columns.set(planned.fieldId, planned.column);
          }
          const masks = yield* buildFieldMaskSqlMap(sourcePlan.scope.fieldMasks, sqlAlias);
          const visitor = new StoredFieldSelectVisitor(sqlAlias);
          const values = new Map<string, RawBuilder<unknown>>();
          for (const [id, field] of fields) {
            const selected = yield* field.accept(visitor);
            const expression = sql`${selected.expression}`;
            const mask = masks?.get(id);
            values.set(id, mask ? maskValueExpression(mask, expression) : expression);
          }
          expressionSources.set(source.alias, {
            table: sourcePlan.table,
            scope: sourcePlan.scope,
            sqlAlias,
            fields,
            values,
            masks,
          });
          const expressionPredicate = boundPlan.relationPredicates?.find(
            (predicate) => predicate.source === source.alias
          )?.predicate;
          const expressionRestriction = expressionPredicate
            ? yield* compileDataQueryPredicate(expressionPredicate, expressionContext)
            : undefined;
          const relationFilter = replaceCurrentUserTagInFilter(
            sourcePlan.table,
            plan.query.relationFilters?.[source.alias],
            context.actorId.toString()
          );
          // Representative/default values were checked at prepare; bound values
          // (notably isNot + dateRange) must satisfy the same contract here.
          yield* validateDataQueryFilter(sourcePlan.table, relationFilter);
          const filterRestriction =
            boundPlan.definitionVersion < 3 && relationFilter
              ? yield* buildRecordWhereClause(
                  yield* buildRecordConditionSpec(
                    sourcePlan.table,
                    relationFilter,
                    sourcePlan.scope.fieldMasks
                  ),
                  { tableAlias: sqlAlias }
                )
              : undefined;
          const restriction = sourcePlan.scope.recordSpec
            ? yield* buildRecordWhereClause(sourcePlan.scope.recordSpec, {
                tableAlias: sqlAlias,
              })
            : undefined;
          if (
            source.linkFieldId === undefined ||
            source.link === undefined ||
            source.parentAlias === undefined
          ) {
            return err(failure('join_storage', 'A relation source has no link storage'));
          }
          // A masked link edge must not reveal membership. The mask belongs to the
          // table that hosts the link (root for the first hop, the parent alias after).
          const parentMasks =
            source.parentAlias === 'root'
              ? rootMasks
              : sqlSources.find((candidate) => candidate.alias === source.parentAlias)?.masks;
          const linkMask = parentMasks?.get(source.linkFieldId);
          const restrictions: RawBuilder<unknown>[] = [];
          if (boundPlan.definitionVersion >= 4 && expressionScope)
            restrictions.push(expressionScope);
          if (linkMask) restrictions.push(sql`${linkMask}`);
          if (filterRestriction) restrictions.push(sql`${filterRestriction}`);
          if (restriction) restrictions.push(sql`${restriction}`);
          const visibility = [...restrictions];
          if (expressionRestriction)
            restrictions.push(
              restrictions.length
                ? sql`(case when ${sql.join(restrictions, sql` and `)} then ${expressionRestriction} else false end)`
                : expressionRestriction
            );
          sqlSources.push({
            alias: source.alias,
            cardinality: source.cardinality,
            sqlAlias,
            from,
            parentAlias: source.parentAlias,
            linkFieldId: source.linkFieldId,
            linkStorage: source.link,
            fields,
            columns,
            values,
            masks,
            restrictions,
            visibility,
          });
        }
        const sourceByAlias = new Map(sqlSources.map((source) => [source.alias, source]));
        const sourceIndexByAlias = new Map(
          sqlSources.map((source, index) => [source.alias, index] as const)
        );
        const parentSqlAlias = (source: SqlSource): string | undefined =>
          source.parentAlias === 'root' ? rootAlias : sqlAliases.get(source.parentAlias);
        const membership = (
          source: SqlSource,
          parentAlias: string
        ): RawBuilder<unknown> | undefined => {
          if (source.linkStorage.kind === 'root-fk')
            return sql`${sql.id(source.sqlAlias, '__id')} = ${sql.id(parentAlias, source.linkStorage.column)}`;
          if (
            source.linkStorage.kind === 'target-fk' ||
            source.linkStorage.kind === 'target-fk-many'
          )
            return sql`${sql.id(source.sqlAlias, source.linkStorage.column)} = ${sql.id(parentAlias, '__id')}`;
          if (source.linkStorage.kind !== 'junction') return undefined;
          const junctionAlias = `junction_${sourceIndexByAlias.get(source.alias)}`;
          const junctionFrom = source.linkStorage.schema
            ? sql`${sql.id(source.linkStorage.schema, source.linkStorage.tableName)} as ${sql.id(
                junctionAlias
              )}`
            : sql`${sql.id(source.linkStorage.tableName)} as ${sql.id(junctionAlias)}`;
          return sql`exists (
            select 1 from ${junctionFrom}
            where ${sql.id(junctionAlias, source.linkStorage.selfKeyName)} = ${sql.id(
              parentAlias,
              '__id'
            )}
              and ${sql.id(junctionAlias, source.linkStorage.foreignKeyName)} = ${sql.id(
                source.sqlAlias,
                '__id'
              )}
          )`;
        };
        expressionContext.compileExistence = (alias) => {
          const chain: SqlSource[] = [];
          let cursor = sourceByAlias.get(alias);
          if (!cursor)
            return err(failure('invalid_relation_plan', 'An existence source is missing'));
          while (cursor) {
            chain.unshift(cursor);
            if (cursor.parentAlias === 'root') break;
            cursor = sourceByAlias.get(cursor.parentAlias);
            if (!cursor)
              return err(failure('invalid_relation_plan', 'An existence ancestor is missing'));
          }
          const froms: RawBuilder<unknown>[] = [];
          const visibility: RawBuilder<unknown>[] = [];
          for (const source of chain) {
            const parent = parentSqlAlias(source);
            let link: RawBuilder<unknown> | undefined;
            if (parent && source.linkStorage.kind === 'junction') {
              const storage = source.linkStorage;
              const junctionAlias = `exists_junction_${sourceIndexByAlias.get(source.alias)}`;
              const junctionFrom = storage.schema
                ? sql`${sql.id(storage.schema, storage.tableName)} as ${sql.id(junctionAlias)}`
                : sql`${sql.id(storage.tableName)} as ${sql.id(junctionAlias)}`;
              // Start from the edge, not every target row. Keep both equalities
              // visible to the planner; a membership EXISTS inside CASE cannot
              // become a join and otherwise scans root × target for any/none.
              froms.push(
                sql`${junctionFrom} join ${source.from} on ${sql.id(
                  junctionAlias,
                  storage.foreignKeyName
                )} = ${sql.id(source.sqlAlias, '__id')}`
              );
              link = sql`${sql.id(junctionAlias, storage.selfKeyName)} = ${sql.id(parent, '__id')}`;
            } else {
              froms.push(source.from);
              link = parent ? membership(source, parent) : undefined;
            }
            if (!link)
              return err(failure('join_storage', 'An existence hop has no physical storage'));
            visibility.push(link, ...source.visibility);
          }
          const guard = sql.join(visibility, sql` and `);
          let matches: RawBuilder<unknown> = sql`true`;
          for (let index = chain.length - 1; index >= 0; index--) {
            const restrictions = chain[index]!.restrictions;
            if (restrictions.length)
              matches = sql`case when ${sql.join(restrictions, sql` and `)} then ${matches} else false end`;
          }
          // Keep correlations planner-visible without removing the formula evaluation guard.
          return ok(sql`exists (
            select 1 from ${sql.join(froms, sql`, `)}
            where ${guard} and case when ${guard} then (${matches}) else false end
          )`);
        };

        // To-one joins come first: every to-one parent is root or an earlier to-one.
        const joins: RawBuilder<unknown>[] = [];
        for (const source of sqlSources) {
          if (source.cardinality === 'many') continue;
          const parentAlias = parentSqlAlias(source);
          if (!parentAlias) {
            return err(failure('invalid_relation_plan', 'A relation parent source is missing'));
          }
          const linkPredicate = membership(source, parentAlias);
          if (!linkPredicate) {
            return err(failure('join_storage', 'A to-one relation has no physical storage'));
          }
          const joinCondition: RawBuilder<unknown>[] = [linkPredicate, ...source.restrictions];
          joins.push(sql`left join ${source.from} on ${sql.join(joinCondition, sql` and `)}`);
        }

        // One lateral per to-many branch, keyed by the outer parent row. Branches
        // never join each other, so a second metric source cannot multiply rows.
        const manyLaterals: RawBuilder<unknown>[] = [];
        const aggregateAliases = new Map<string, string>();
        for (const [index, source] of sqlSources.entries()) {
          if (source.cardinality !== 'many') continue;
          const metrics = metricsBySource.get(source.alias) ?? [];
          if (metrics.length === 0) continue;
          const chain: SqlSource[] = [];
          let cursor: SqlSource | undefined = source;
          while (cursor && cursor.cardinality === 'many') {
            chain.unshift(cursor);
            cursor =
              cursor.parentAlias === 'root' ? undefined : sourceByAlias.get(cursor.parentAlias);
          }
          const anchor = chain[0]!;
          const anchorParentAlias = parentSqlAlias(anchor);
          if (!anchorParentAlias) {
            return err(failure('invalid_relation_plan', 'A relation parent source is missing'));
          }
          const anchorMembership = membership(anchor, anchorParentAlias);
          if (!anchorMembership) {
            return err(failure('join_storage', 'A to-many relation has no physical storage'));
          }
          const froms: RawBuilder<unknown>[] = [anchor.from];
          const conditions: RawBuilder<unknown>[] = [anchorMembership, ...anchor.restrictions];
          for (let hop = 1; hop < chain.length; hop++) {
            const child = chain[hop]!;
            const parent = chain[hop - 1]!;
            const link = membership(child, parent.sqlAlias);
            if (!link) {
              return err(failure('join_storage', 'A to-many relation has no physical storage'));
            }
            froms.push(sql`join ${child.from} on ${link}`);
            conditions.push(...child.restrictions);
          }
          // A target record reachable through several intermediate records is one
          // member of the branch: dedupe by the metric source's primary key.
          const leaf = chain[chain.length - 1]!;
          const dedupe = chain.length > 1;
          const project = dedupe || metrics.some((metric) => metric.expression || metric.filter);
          const dedupeAlias = 'branch_rows';
          const valueColumns: RawBuilder<unknown>[] = [];
          const selections: RawBuilder<unknown>[] = [];
          for (const metric of metrics) {
            const rawValue = metric.expression
              ? yield* compileDataQueryFormulaExpression(metric.expression, expressionContext)
              : metric.statisticFunc === 'count'
                ? sql`1`
                : leaf.values.get(metric.fieldId!);
            if (!rawValue) throw new Error('Missing relation aggregate field');
            const field =
              metric.expression || metric.fieldId === undefined
                ? undefined
                : leaf.fields.get(metric.fieldId);
            if (!metric.expression && metric.statisticFunc !== 'count' && !field) {
              throw new Error('Missing relation aggregate field metadata');
            }
            const guard = conditions.length ? sql`${sql.join(conditions, sql` and `)}` : undefined;
            // A metric's own predicate also guards evaluation of its formula.
            const compiledFilter = metric.filter
              ? yield* compileDataQueryPredicate(metric.filter, expressionContext)
              : undefined;
            const predicate =
              compiledFilter && guard
                ? sql`case when ${guard} then ${compiledFilter} else false end`
                : compiledFilter;
            const allowed = predicate ?? guard;
            const value =
              metric.expression && allowed
                ? sql`case when ${allowed} then ${rawValue} else null end`
                : rawValue;
            const fieldType = field?.type().toString();
            const normalizedValue =
              fieldType === 'user' || fieldType === 'createdBy' || fieldType === 'lastModifiedBy'
                ? buildUserJsonObjectFromSnapshotExpr(value)
                : value;
            const filterColumn = `${metricValueAlias(metric)}_filter`;
            if (project) {
              valueColumns.push(sql`${normalizedValue} as ${sql.id(metricValueAlias(metric))}`);
              if (predicate) valueColumns.push(sql`${predicate} as ${sql.id(filterColumn)}`);
            }
            const column = project
              ? sql.id(dedupeAlias, metricValueAlias(metric))
              : normalizedValue;
            const filter = predicate
              ? project
                ? sql.id(dedupeAlias, filterColumn)
                : predicate
              : undefined;
            if (metric.statisticFunc === 'average' && grouped) {
              selections.push(
                sql`${buildTableRecordAggregationExpression(column, 'sum', field, filter)} as ${sql.id(metricSumAlias(metric))}`,
                sql`${buildTableRecordAggregationExpression(column, 'filled', field, filter)} as ${sql.id(metricCountAlias(metric))}`
              );
            } else {
              selections.push(
                sql`${buildTableRecordAggregationExpression(column, metric.statisticFunc, field, filter)} as ${sql.id(metric.alias)}`
              );
            }
          }
          const whereClause = sql`where ${sql.join(conditions, sql` and `)}`;
          const body = project
            ? sql`select ${sql.join(selections)} from (
                select ${dedupe ? sql`distinct` : sql``} ${sql.id(leaf.sqlAlias, '__id')} as ${sql.id('__id')}
                  ${valueColumns.length ? sql`, ${sql.join(valueColumns)}` : sql``}
                from ${sql.join(froms, sql` `)} ${whereClause} offset 0
              ) as ${sql.id(dedupeAlias)}`
            : sql`select ${sql.join(selections)} from ${sql.join(froms, sql` `)} ${whereClause}`;
          const aggregateAlias = `aggregate_${index}`;
          aggregateAliases.set(source.alias, aggregateAlias);
          // One row per parent key, so the root result keeps its row shape and
          // offset/total semantics; target filters and row scope stay inside.
          manyLaterals.push(sql`left join lateral (${body}) as ${sql.id(aggregateAlias)} on true`);
        }

        const predicates: RawBuilder<unknown>[] = [];
        if (plan.query.recordId !== undefined) {
          predicates.push(sql`${sql.id(rootAlias, '__id')} = ${plan.query.recordId}`);
        }
        const filter = replaceCurrentUserTagInFilter(
          plan.rootTable,
          plan.query.filter,
          context.actorId.toString()
        );
        if (boundPlan.definitionVersion < 3 && filter != null) {
          const condition = yield* buildRecordConditionSpec(
            plan.rootTable,
            filter,
            plan.rootScope.fieldMasks
          );
          const where = yield* buildRecordWhereClause(condition, { tableAlias: rootAlias });
          if (where) predicates.push(sql`${where}`);
        }
        if (expressionScope) predicates.push(expressionScope);
        if (boundPlan.predicate) {
          const predicate = yield* compileDataQueryPredicate(
            boundPlan.predicate,
            expressionContext
          );
          if (predicate)
            predicates.push(
              expressionScope
                ? sql`(case when ${expressionScope} then ${predicate} else false end)`
                : predicate
            );
        }
        const where = predicates.length ? sql`where ${sql.join(predicates, sql` and `)}` : sql``;

        if (boundPlan.kind === 'aggregate') {
          const innerSelections: RawBuilder<unknown>[] = [];
          const rootInnerAlias = (fieldId: string) => `root__${fieldId}`;
          const sourceInnerAlias = (index: number, fieldId: string) =>
            `source_${index}__${fieldId}`;
          const rootAggregates = boundPlan.aggregates.filter(
            (aggregate) => aggregate.source === 'root'
          );
          const rootIds = new Set<string>([
            ...rootAggregates.flatMap((aggregate) =>
              aggregate.fieldId ? [aggregate.fieldId] : []
            ),
            ...boundPlan.groupBy
              .filter((group) => group.source === 'root')
              .map((group) => group.fieldId),
          ]);
          for (const fieldId of rootIds) {
            const expression = rootValues.get(fieldId);
            if (!expression) {
              return err(failure('invalid_relation_plan', 'A root field is not bound'));
            }
            innerSelections.push(sql`${expression} as ${sql.id(rootInnerAlias(fieldId))}`);
          }
          const rootMetricColumns = new Map<string, string>();
          const rootMetricFilters = new Map<string, string>();
          for (const [index, metric] of rootAggregates.entries()) {
            const predicate = metric.filter
              ? yield* compileDataQueryPredicate(metric.filter, expressionContext)
              : undefined;
            const allowed =
              predicate && expressionScope
                ? sql`case when ${expressionScope} then ${predicate} else false end`
                : (predicate ?? expressionScope);
            if (metric.expression) {
              const column = `__root_metric_${index}`;
              const compiled = yield* compileDataQueryFormulaExpression(
                metric.expression,
                expressionContext
              );
              rootMetricColumns.set(metric.alias, column);
              innerSelections.push(
                sql`${allowed ? sql`case when ${allowed} then ${compiled} else null end` : compiled} as ${sql.id(column)}`
              );
            }
            if (metric.filter) {
              const column = `__root_metric_filter_${index}`;
              rootMetricFilters.set(metric.alias, column);
              innerSelections.push(sql`${allowed ?? sql`true`} as ${sql.id(column)}`);
            }
          }
          for (const [alias, index] of sourceIndexByAlias) {
            const source = sqlSources[index];
            const fieldIds = new Set(
              boundPlan.groupBy
                .filter((group) => group.source === alias)
                .map((group) => group.fieldId)
            );
            for (const fieldId of fieldIds) {
              const expression = source.values.get(fieldId);
              if (!expression) {
                return err(failure('invalid_relation_plan', 'A source group field is not bound'));
              }
              innerSelections.push(
                sql`${expression} as ${sql.id(sourceInnerAlias(index, fieldId))}`
              );
            }
          }
          // Bucket expressions become private inner columns so GROUP BY never
          // references a public alias that could shadow an input column.
          const bucketColumns = new Map<string, string>();
          for (const [index, group] of boundPlan.groupBy.entries()) {
            const bucket = group.bucket;
            if (bucket === undefined) continue;
            const source = group.source;
            const position = source === rootAlias ? undefined : sourceIndexByAlias.get(source);
            if (source !== rootAlias && position === undefined) {
              return err(failure('invalid_relation_plan', 'A group source is missing'));
            }
            const expression =
              source === rootAlias
                ? rootValues.get(group.fieldId)
                : sqlSources[position!].values.get(group.fieldId);
            if (!expression) {
              return err(failure('invalid_relation_plan', 'A bucket field is not bound'));
            }
            const privateName = `__bucket_${index}`;
            bucketColumns.set(group.alias, privateName);
            innerSelections.push(
              sql`${buildBucketExpression(expression, bucket)} as ${sql.id(privateName)}`
            );
          }
          // One row per root: each branch's pre-aggregate is a scalar column.
          const metricSelections: RawBuilder<unknown>[] = [];
          for (const metric of relationMetrics) {
            const aggregateAlias = aggregateAliases.get(metric.source);
            if (!aggregateAlias) {
              return err(failure('invalid_relation_plan', 'A relation metric has no branch'));
            }
            if (metric.statisticFunc === 'average') {
              metricSelections.push(
                sql`${sql.id(aggregateAlias, metricSumAlias(metric))} as ${sql.id(
                  metricSumAlias(metric)
                )}`
              );
              metricSelections.push(
                sql`${sql.id(aggregateAlias, metricCountAlias(metric))} as ${sql.id(
                  metricCountAlias(metric)
                )}`
              );
              continue;
            }
            metricSelections.push(
              sql`${sql.id(aggregateAlias, metric.alias)} as ${sql.id(metric.alias)}`
            );
          }
          const inner = sql`select ${sql.join([...innerSelections, ...metricSelections])} from ${rootFrom}
            ${sql.join([...joins, ...manyLaterals], sql` `)} ${where} ${rootMetricColumns.size || rootMetricFilters.size ? sql`offset 0` : sql``}`;
          const selections: RawBuilder<unknown>[] = [];
          for (const aggregate of boundPlan.aggregates) {
            if (aggregate.source !== 'root') {
              if (!aggregateAliases.has(aggregate.source)) {
                return err(failure('invalid_relation_plan', 'A relation metric has no branch'));
              }
              // The inner query already holds one scalar per root; the group
              // combine reads the inner row, never the lateral alias.
              const column = sql.id('b', aggregate.alias);
              switch (aggregate.statisticFunc) {
                case 'count':
                  selections.push(
                    boundPlan.definitionVersion >= 4
                      ? sql`coalesce(sum(${column}), 0) as ${sql.id(aggregate.alias)}`
                      : sql`sum(${column}) as ${sql.id(aggregate.alias)}`
                  );
                  break;
                case 'sum':
                  selections.push(sql`sum(${column}) as ${sql.id(aggregate.alias)}`);
                  break;
                case 'min':
                  selections.push(sql`min(${column}) as ${sql.id(aggregate.alias)}`);
                  break;
                case 'max':
                  selections.push(sql`max(${column}) as ${sql.id(aggregate.alias)}`);
                  break;
                case 'average':
                  // Weighted mean over every related value in the group.
                  selections.push(
                    sql`sum(${sql.id('b', metricSumAlias(aggregate as BoundMetric))}) / nullif(sum(${sql.id(
                      'b',
                      metricCountAlias(aggregate as BoundMetric)
                    )}), 0) as ${sql.id(aggregate.alias)}`
                  );
                  break;
                default:
                  return err(
                    failure('invalid_relation_plan', 'Unsupported grouped relation metric')
                  );
              }
              continue;
            }
            const field = aggregate.fieldId ? rootFields.get(aggregate.fieldId) : undefined;
            if (!aggregate.expression && !field) {
              return err(failure('invalid_relation_plan', 'A root aggregate field is not bound'));
            }
            const column =
              rootMetricColumns.get(aggregate.alias) ?? rootInnerAlias(aggregate.fieldId!);
            const filter = rootMetricFilters.get(aggregate.alias);
            const value = buildTableRecordAggregationExpression(
              sql.id('b', column),
              aggregate.statisticFunc,
              aggregate.expression ? undefined : field,
              filter ? sql.id('b', filter) : undefined
            );
            selections.push(sql`${value} as ${sql.id(aggregate.alias)}`);
          }
          const groups = new Map<string, RawBuilder<unknown>>();
          for (const group of boundPlan.groupBy) {
            const source = group.source;
            const sourcePosition =
              source === rootAlias ? undefined : sourceIndexByAlias.get(source);
            if (source !== rootAlias && sourcePosition === undefined) {
              return err(failure('invalid_relation_plan', 'A group source is missing'));
            }
            const columnName =
              source === rootAlias
                ? rootInnerAlias(group.fieldId)
                : sourceInnerAlias(sourcePosition!, group.fieldId);
            const bucketColumn = bucketColumns.get(group.alias);
            const groupField =
              source === rootAlias
                ? rootFields.get(group.fieldId)!
                : sqlSources[sourcePosition!].fields.get(group.fieldId)!;
            let expression: RawBuilder<unknown>;
            if (bucketColumn !== undefined) {
              expression = sql.ref(`b.${bucketColumn}`);
            } else {
              const multiplicity = yield* resolveUserGroupIdentityMultiplicity(groupField);
              expression =
                multiplicity == null
                  ? (buildDateLikeGroupExpression(
                      groupField,
                      'b',
                      source === rootAlias
                        ? rootInnerAlias(group.fieldId)
                        : sourceInnerAlias(sourcePosition!, group.fieldId)
                    ) ?? sql.ref(`b.${columnName}`))
                  : buildUserGroupIdentityExpr(sql.ref(`b.${columnName}`), multiplicity);
            }
            groups.set(`group:${group.alias}`, expression);
            selections.push(sql`${expression} as ${sql.id(group.alias)}`);
          }
          const orders: RawBuilder<unknown>[] = [];
          const addOrder = (
            expression: RawBuilder<unknown>,
            direction: 'asc' | 'desc',
            nulls?: 'first' | 'last'
          ) => {
            const nullOrder = nulls ?? (direction === 'asc' ? 'first' : 'last');
            orders.push(
              direction === 'asc'
                ? nullOrder === 'first'
                  ? sql`${expression} asc nulls first`
                  : sql`${expression} asc nulls last`
                : nullOrder === 'first'
                  ? sql`${expression} desc nulls first`
                  : sql`${expression} desc nulls last`
            );
          };
          for (const sort of plan.query.sort) {
            if ('alias' in sort) {
              addOrder(sql.id(sort.alias), sort.order, sort.nulls);
              continue;
            }
            if (!('fieldId' in sort) || 'source' in sort) {
              return err(failure('invalid_sort', 'Aggregate sorting must use a group alias'));
            }
            const group = boundPlan.groupBy.find(
              (candidate) =>
                candidate.source === rootAlias &&
                candidate.fieldId === sort.fieldId &&
                candidate.bucket === undefined
            );
            const field = rootFields.get(sort.fieldId);
            const expression = group === undefined ? undefined : groups.get(`group:${group.alias}`);
            if (!field || !expression) {
              return err(
                failure('invalid_sort', 'Aggregate sorting requires a root grouping field')
              );
            }
            const clauses = yield* buildStoredFieldOrderByClauses(
              field,
              rootInnerAlias(sort.fieldId),
              sort.order,
              'b',
              { columnExpression: expression, groupIdentityCollation: true }
            );
            clauses.forEach((clause, index) =>
              addOrder(clause.expression, clause.direction, index === 0 ? sort.nulls : undefined)
            );
          }
          for (const group of boundPlan.groupBy) {
            if (
              !orders.length ||
              !plan.query.sort.some((sort) => 'alias' in sort && sort.alias === group.alias)
            ) {
              addOrder(sql.id(group.alias), 'asc');
            }
          }
          const groupClause = groups.size ? sql`group by ${sql.join([...groups.values()])}` : sql``;
          const orderClause = orders.length ? sql`order by ${sql.join(orders)}` : sql``;
          if (boundPlan.having) {
            const combined = sql`select ${sql.join(selections)} from (${inner}) as ${sql.id('b')} ${groupClause}`;
            const predicate = yield* compileDataQueryHavingExpression(
              boundPlan.having,
              expressionContext,
              'aggregate_outputs'
            );
            const filtered = sql`select * from (${combined}) as ${sql.id('aggregate_outputs')} where ${predicate}`;
            orders.length = 0;
            for (const sort of plan.query.sort) {
              if ('alias' in sort) {
                addOrder(sql.id('aggregate_outputs', sort.alias), sort.order, sort.nulls);
                continue;
              }
              const group = boundPlan.groupBy.find(
                (candidate) =>
                  'fieldId' in sort &&
                  candidate.fieldId === sort.fieldId &&
                  candidate.source === 'root' &&
                  !candidate.bucket
              );
              if (!group || !('fieldId' in sort)) throw new Error('Missing aggregate sort output');
              const expression = sql`${sql.id('aggregate_outputs', group.alias)}`;
              const clauses = yield* buildStoredFieldOrderByClauses(
                rootFields.get(sort.fieldId)!,
                group.alias,
                sort.order,
                'aggregate_outputs',
                { columnExpression: expression, groupIdentityCollation: true }
              );
              clauses.forEach((clause, index) =>
                addOrder(clause.expression, clause.direction, index === 0 ? sort.nulls : undefined)
              );
            }
            for (const group of boundPlan.groupBy) {
              if (!plan.query.sort.some((sort) => 'alias' in sort && sort.alias === group.alias))
                addOrder(sql.id('aggregate_outputs', group.alias), 'asc');
            }
            const rows =
              sql<Row>`${filtered} ${orders.length ? sql`order by ${sql.join(orders)}` : sql``} limit ${plan.query.limit} offset ${plan.query.offset}`.compile(
                db
              );
            return ok({
              rows,
              ...(plan.query.includeTotal
                ? {
                    count: sql<{
                      total: unknown;
                    }>`select count(*) as ${sql.id('total')} from (${filtered}) as ${sql.id('counted')}`.compile(
                      db
                    ),
                  }
                : {}),
            });
          }
          const rows = sql<Row>`select ${sql.join(selections)} from (${inner}) as ${sql.id('b')}
            ${groupClause} ${orderClause} limit ${plan.query.limit} offset ${plan.query.offset}`.compile(
            db
          );
          if (!plan.query.includeTotal) return ok({ rows });
          if (!groups.size) return ok({ rows, constantTotal: 1 });
          // Group keys never read a to-many branch, so the total reuses the inner
          // query without the per-root metric subqueries.
          const countInner = sql`select ${sql.join(innerSelections)} from ${rootFrom}
            ${sql.join(joins, sql` `)} ${where}`;
          const count = sql<{
            total: unknown;
          }>`select count(*) as ${sql.id('total')} from (
            select 1 from (${countInner}) as ${sql.id('b')} ${groupClause}
          ) as ${sql.id('grouped')}`.compile(db);
          return ok({ rows, count });
        }

        const expressionSelections = new Map<string, RawBuilder<unknown>>();
        for (const projection of boundPlan.projections) {
          if (projection.kind !== 'expression') continue;
          expressionSelections.set(
            projection.alias,
            yield* compileDataQueryFormulaExpression(
              projection.expression,
              expressionContext,
              'display'
            )
          );
        }
        const selections = boundPlan.projections.map((projection) => {
          if (projection.kind === 'expression') {
            const value = expressionSelections.get(projection.alias)!;
            return sql`${value} as ${sql.id(projection.alias)}`;
          }
          if (projection.kind === 'aggregate') {
            const aggregateAlias = aggregateAliases.get(projection.source);
            if (!aggregateAlias) throw new Error('Missing relation aggregate source');
            return sql`${sql.id(aggregateAlias, projection.alias)} as ${sql.id(projection.alias)}`;
          }
          const source = projection.source;
          const sqlAlias = source === 'root' ? rootAlias : sqlAliases.get(source)!;
          if (projection.kind === 'system') {
            const expression = sql`${sql.id(sqlAlias, projection.column)}`;
            return sql`${expression} as ${sql.id(projection.alias)}`;
          }
          const values =
            source === 'root'
              ? rootValues
              : sqlSources.find((candidate) => candidate.alias === source)?.values;
          const stored = values?.get(projection.fieldId);
          if (!stored || projection.column === null) throw new Error('Missing relation projection');
          const expression =
            projection.bucket !== undefined
              ? buildBucketExpression(stored, projection.bucket)
              : stored;
          return sql`${
            projection.arrayDistinct === true
              ? buildArrayDistinctExpression(expression)
              : expression
          } as ${sql.id(projection.alias)}`;
        });
        if (boundPlan.resultGrain === 'distinctTuple') {
          return ok(
            compileDistinctRecords(
              db,
              sql`select ${sql.join(selections)} from ${rootFrom} ${sql.join([...joins, ...manyLaterals], sql` `)} ${where}`,
              boundPlan,
              plan.query,
              typeValidationStrategy
            )
          );
        }

        const orders: RawBuilder<unknown>[] = [];
        const addOrder = (
          expression: RawBuilder<unknown>,
          direction: 'asc' | 'desc',
          matchNulls = false,
          nulls?: 'first' | 'last'
        ) => {
          const nullOrder =
            nulls ?? (matchNulls ? (direction === 'asc' ? 'first' : 'last') : undefined);
          orders.push(
            direction === 'asc'
              ? nullOrder === 'first'
                ? sql`${expression} asc nulls first`
                : nullOrder === 'last'
                  ? sql`${expression} asc nulls last`
                  : sql`${expression} asc`
              : nullOrder === 'first'
                ? sql`${expression} desc nulls first`
                : nullOrder === 'last'
                  ? sql`${expression} desc nulls last`
                  : sql`${expression} desc`
          );
        };
        for (const sort of plan.query.sort) {
          if ('source' in sort) {
            const target = sqlSources.find((candidate) => candidate.alias === sort.source);
            const targetAlias = sqlAliases.get(sort.source);
            if (!target || !targetAlias) {
              return err(
                failure('invalid_sort', 'A sort references a source outside the relation plan')
              );
            }
            if (target.cardinality === 'many') {
              return err(
                failure(
                  'invalid_sort',
                  'A to-many relation cannot be sorted directly; sort by an aggregate alias'
                )
              );
            }
            if ('system' in sort) {
              addOrder(
                sql.id(targetAlias, systemColumns[sort.system]),
                sort.order,
                true,
                sort.nulls
              );
              continue;
            }
            const field = target.fields.get(sort.fieldId);
            const column = target.columns.get(sort.fieldId);
            const value = target.values.get(sort.fieldId);
            if (!field || !column || !value) {
              return err(failure('invalid_sort', 'A sort field is not part of the query binding'));
            }
            const clauses = yield* buildStoredFieldOrderByClauses(
              field,
              column,
              sort.order,
              targetAlias,
              { columnExpression: value }
            );
            clauses.forEach((clause, index) =>
              addOrder(
                clause.expression,
                clause.direction,
                clause.matchV1Nulls,
                index === 0 ? sort.nulls : undefined
              )
            );
            continue;
          }
          if ('alias' in sort) {
            addOrder(sql.id(sort.alias), sort.order, boundPlan.definitionVersion >= 3, sort.nulls);
            continue;
          }
          if ('system' in sort) {
            addOrder(sql.id(rootAlias, systemColumns[sort.system]), sort.order, true, sort.nulls);
            continue;
          }
          const field = rootFields.get(sort.fieldId);
          const column = rootColumns.get(sort.fieldId);
          const value = rootValues.get(sort.fieldId);
          if (!field || !column || !value) {
            return err(failure('invalid_sort', 'A sort field is not part of the query binding'));
          }
          const clauses = yield* buildStoredFieldOrderByClauses(
            field,
            column,
            sort.order,
            rootAlias,
            {
              columnExpression: value,
            }
          );
          clauses.forEach((clause, index) =>
            addOrder(
              clause.expression,
              clause.direction,
              clause.matchV1Nulls,
              index === 0 ? sort.nulls : undefined
            )
          );
        }
        addOrder(sql.id(rootAlias, '__id'), 'asc');
        const rows = sql<Row>`select ${sql.join(selections)} from ${rootFrom}
          ${sql.join([...joins, ...manyLaterals], sql` `)} ${where}
          order by ${sql.join(orders)} limit ${plan.query.limit} offset ${plan.query.offset}`.compile(
          db
        );
        if (!plan.query.includeTotal) return ok({ rows });
        const count = sql<{
          total: unknown;
        }>`select count(*) as ${sql.id('total')} from ${rootFrom} ${where}`.compile(db);
        return ok({ rows, count });
      });
    } catch {
      return err(failure('compile_failed', 'Unable to compile data query'));
    }
  }

  async executeRelation(
    context: IExecutionContext,
    plan: DataQueryRelationPlan
  ): Promise<Result<DataQueryResult, DomainError>> {
    const compiled = await this.compileRelation(context, plan);
    if (compiled.isErr()) return err(compiled.error);
    try {
      const read = await traceDataQueryStage(
        context,
        'database.readOnly.relation',
        {
          'teable.component': 'repository',
          'teable.table_id': plan.rootTable.id().toString(),
          'teable.data_query.kind': plan.plan.kind,
          'teable.data_query.relation_count': plan.sources.length,
          'teable.data_query.limit': plan.query.limit,
          'teable.data_query.offset': plan.query.offset,
          ...(plan.query.includeTotal ? { 'teable.data_query.include_total': true } : {}),
        },
        async () => {
          try {
            const queries = compiled.value;
            return ok(
              await this.db.transaction().execute(async (transaction) => {
                await transaction.executeQuery(
                  sql`set transaction isolation level repeatable read`.compile(this.db)
                );
                await transaction.executeQuery(sql`set transaction read only`.compile(this.db));
                await transaction.executeQuery(
                  sql`select set_config('statement_timeout', ${String(this.statementTimeoutMs)}, true)`.compile(
                    this.db
                  )
                );
                const pages = await transaction.executeQuery(queries.rows);
                if (!plan.query.includeTotal) return { pages, total: undefined };
                if (queries.constantTotal !== undefined) {
                  return { pages, total: queries.constantTotal };
                }
                if (!queries.count) throw new Error('Missing count query');
                const counted = await transaction.executeQuery(queries.count);
                return { pages, total: parseTotal(counted.rows[0]?.total) };
              })
            );
          } catch (error) {
            return err(dataQueryExecutionError(error, plan.plan.definitionVersion >= 3));
          }
        }
      );
      if (read.isErr()) return err(read.error);
      const { pages, total } = read.value;
      if (plan.query.includeTotal && total === undefined) {
        return err(
          domainError.infrastructure({
            code: 'data_query.execution_failed',
            message: 'Unable to resolve the data query total',
          })
        );
      }
      const statistics = new Map(
        plan.plan.kind === 'records'
          ? plan.plan.projections
              .filter((projection) => projection.kind === 'aggregate')
              .map((projection) => [projection.alias, projection.statisticFunc] as const)
          : plan.plan.kind === 'aggregate'
            ? plan.plan.aggregates.map(
                (aggregate) => [aggregate.alias, aggregate.statisticFunc] as const
              )
            : []
      );
      return ok({
        rows: pages.rows.map((row) => {
          const output: Row = {};
          for (const [alias, value] of Object.entries(row)) {
            output[alias] =
              plan.plan.resultGrain === 'distinctTuple'
                ? value
                : normalizeDataQueryValue(value, statistics.get(alias));
          }
          return output;
        }),
        ...(total === undefined
          ? {}
          : { page: { limit: plan.query.limit, offset: plan.query.offset, total } }),
      });
    } catch {
      return err(
        domainError.infrastructure({
          code: 'data_query.execution_failed',
          message: 'Unable to execute data query',
        })
      );
    }
  }

  async execute(
    context: IExecutionContext,
    table: Table,
    query: BoundDataQuery,
    scope: RecordQueryPluginScope,
    binding?: DataQueryBinding
  ): Promise<Result<DataQueryResult, DomainError>> {
    const prepared = this.prepareBinding(context, table, query, binding);
    if (prepared.isErr()) return err(prepared.error);
    const bound = prepared.value;
    const compiled = await traceDataQueryStage(
      context,
      'compile',
      { 'teable.component': 'repository' },
      async () => this.buildQueries(context, table, query, scope, bound)
    );
    if (compiled.isErr()) return err(compiled.error);
    try {
      const read = await traceDataQueryStage(
        context,
        'database.readOnly',
        {
          'teable.component': 'repository',
          'teable.table_id': table.id().toString(),
          'teable.data_query.kind': bound.plan.kind,
          'teable.data_query.limit': query.limit,
          'teable.data_query.offset': query.offset,
          ...(query.includeTotal ? { 'teable.data_query.include_total': true } : {}),
        },
        async () => {
          try {
            const queries = compiled.value;
            // Rows and the total must share one snapshot: READ COMMITTED would give each
            // statement its own, letting a concurrent commit change the count mid-page.
            return ok(
              await this.db.transaction().execute(async (transaction) => {
                // Compiling through the outer handle keeps these statements on the real
                // transaction while recording remains possible for tests.
                await transaction.executeQuery(
                  sql`set transaction isolation level repeatable read`.compile(this.db)
                );
                await transaction.executeQuery(sql`set transaction read only`.compile(this.db));
                await transaction.executeQuery(
                  sql`select set_config('statement_timeout', ${String(this.statementTimeoutMs)}, true)`.compile(
                    this.db
                  )
                );
                const pages = await transaction.executeQuery(queries.rows);
                if (!query.includeTotal) return { pages, total: undefined };
                if (queries.constantTotal !== undefined)
                  return { pages, total: queries.constantTotal };
                if (!queries.count) throw new Error('Missing count query');
                const counted = await transaction.executeQuery(queries.count);
                return { pages, total: parseTotal(counted.rows[0]?.total) };
              })
            );
          } catch (error) {
            return err(dataQueryExecutionError(error, bound.plan.definitionVersion >= 3));
          }
        }
      );
      if (read.isErr()) return err(read.error);
      const { pages, total } = read.value;
      if (query.includeTotal && total === undefined) {
        return err(
          domainError.infrastructure({
            code: 'data_query.execution_failed',
            message: 'Unable to resolve the data query total',
          })
        );
      }
      const aggregates = new Map(
        bound.plan.kind === 'aggregate'
          ? bound.plan.aggregates.map(
              (aggregate) => [aggregate.alias, aggregate.statisticFunc] as const
            )
          : []
      );
      return ok({
        rows: pages.rows.map((row) => {
          const output: Row = {};
          for (const [alias, value] of Object.entries(row)) {
            output[alias] =
              bound.plan.resultGrain === 'distinctTuple'
                ? value
                : normalizeDataQueryValue(value, aggregates.get(alias));
          }
          return output;
        }),
        ...(total === undefined
          ? {}
          : { page: { limit: query.limit, offset: query.offset, total } }),
      });
    } catch {
      return err(
        domainError.infrastructure({
          code: 'data_query.execution_failed',
          message: 'Unable to execute data query',
        })
      );
    }
  }
}
