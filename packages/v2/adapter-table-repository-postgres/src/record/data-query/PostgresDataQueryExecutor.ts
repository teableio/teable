import {
  buildRecordConditionSpec,
  domainError,
  replaceCurrentUserTagInFilter,
  type DomainError,
  type Field,
  type IExecutionContext,
  type ITableReadModel,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import {
  assertDataQueryAccess,
  DataQueryBinding,
  DataQueryRelationBinding,
  isBoundDataQuery,
  traceDataQueryStage,
  validateDataQueryFilter,
  type BoundDataQuery,
  type DataQueryAggregate,
  type DataQueryBucket,
  type DataQueryRelationAggregate,
  type DataQueryRelationLinkStorage,
  type DataQueryRelationPlan,
  type DataQueryResult,
  type DataQuerySystemField,
  type IDataQueryExecutor,
} from '@teable/v2-data-query';
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

  constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    options: { statementTimeoutMs?: number } = {}
  ) {
    const timeout = options.statementTimeoutMs ?? 4000;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 60_000) {
      throw new RangeError(
        'Data query statement timeout must be positive and no greater than 60000'
      );
    }
    this.statementTimeoutMs = Math.ceil(timeout);
  }

  /** Diagnostic output only: execute never accepts a compiled statement. */
  compile(
    context: IExecutionContext,
    table: ITableReadModel,
    query: BoundDataQuery,
    scope: RecordQueryPluginScope
  ): Result<CompiledQuery<Row>, DomainError> {
    return this.buildQueries(context, table, query, scope).map((queries) => queries.rows);
  }

  private buildQueries(
    context: IExecutionContext,
    table: ITableReadModel,
    query: BoundDataQuery,
    scope: RecordQueryPluginScope
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
      return safeTry(function* () {
        if (!isBoundDataQuery(query)) {
          return err(failure('invalid_bound_query', 'Query must be bound by DataQueryDefinition'));
        }
        const definition = query.validatedDefinition;
        const binding = yield* DataQueryBinding.prepare(definition, table);
        yield* assertDataQueryAccess(binding, scope);
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
        const snapshot = definition.snapshot();
        const tableName = yield* (yield* table.dbTableName()).split({ defaultSchema: 'public' });
        const fields = new Map<string, Field>();
        const columns = new Map<string, string>();
        for (const dependency of binding.dependencies) {
          const field = yield* table.getField(
            (candidate) => candidate.id().toString() === dependency.fieldId
          );
          fields.set(dependency.fieldId, field);
          columns.set(dependency.fieldId, yield* (yield* field.dbFieldName()).value());
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
        if (filter != null) {
          const condition = yield* buildRecordConditionSpec(table, filter, scope.fieldMasks);
          const where = yield* buildRecordWhereClause(condition, { tableAlias: 't' });
          if (where) predicates.push(sql`${where}`);
        }
        // A direct adapter caller cannot use skipRecordSpec to remove an already-merged scope.
        if (scope.recordSpec) {
          const where = yield* buildRecordWhereClause(scope.recordSpec, { tableAlias: 't' });
          if (where) predicates.push(sql`${where}`);
        }
        const from = tableName.schema
          ? sql`${sql.id(tableName.schema, tableName.tableName)} as ${sql.id('t')}`
          : sql`${sql.id(tableName.tableName)} as ${sql.id('t')}`;
        const where = predicates.length ? sql`where ${sql.join(predicates, sql` and `)}` : sql``;
        const visitor = new StoredFieldSelectVisitor('t');
        const values = new Map<string, RawBuilder<unknown>>();
        for (const [id, field] of fields) {
          const selected = yield* field.accept(visitor);
          const expression = sql`${selected.expression}`;
          const mask = masks?.get(id);
          values.set(id, mask ? maskValueExpression(mask, expression) : expression);
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
        if (snapshot.kind === 'records') {
          if (snapshot.select.some((projection) => 'statisticFunc' in projection)) {
            return err(
              failure('join_version', 'Relation aggregates require a relation execution plan')
            );
          }
          const selections = snapshot.select.map((projection) => {
            if ('system' in projection) {
              return sql`${sql.id('t', systemColumns[projection.system])} as ${sql.id(
                projection.alias
              )}`;
            }
            if ('statisticFunc' in projection || !('fieldId' in projection))
              throw new Error('Missing field projection');
            const stored = values.get(projection.fieldId)!;
            const expression =
              'bucket' in projection && projection.bucket !== undefined
                ? // Teable stores every date cell as an instant (timestamptz), even
                  // when the view formats it as a date; convert through the declared zone.
                  buildBucketExpression(stored, projection.bucket)
                : stored;
            return sql`${
              projection.arrayDistinct === true
                ? buildArrayDistinctExpression(expression)
                : expression
            } as ${sql.id(projection.alias)}`;
          });
          for (const sort of query.sort) {
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

        const rootAggregates: DataQueryAggregate[] = [];
        for (const aggregate of snapshot.aggregates) {
          if ('source' in aggregate) {
            return err(
              failure('invalid_relation_plan', 'A relation metric requires the relation executor')
            );
          }
          rootAggregates.push(aggregate);
        }
        const sourceIds = [
          ...new Set([
            ...rootAggregates.map((aggregate) => aggregate.fieldId),
            ...(snapshot.groupBy ?? []).map((group) => group.fieldId),
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
        const bucketColumns = new Map<string, string>();
        for (const [index, group] of (snapshot.groupBy ?? []).entries()) {
          const bucket = 'bucket' in group ? group.bucket : undefined;
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
        const source = sql`select ${sql.join(sourceSelections)} from ${from} ${where}`;
        const selections = rootAggregates.map(
          (aggregate) =>
            sql`${buildTableRecordAggregationExpression(
              fields.get(aggregate.fieldId)!,
              aggregate.fieldId,
              aggregate.statisticFunc
            )} as ${sql.id(aggregate.alias)}`
        );
        const groups = new Map<string, RawBuilder<unknown>>();
        const bucketGroupAliases = new Set<string>();
        for (const group of snapshot.groupBy ?? []) {
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
              const group = snapshot.groupBy?.find((candidate) => candidate.alias === sort.alias);
              return group ? [group.fieldId] : [];
            }
            return [];
          })
        );
        for (const group of snapshot.groupBy ?? []) {
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
              ? snapshot.groupBy?.find(
                  (candidate) =>
                    candidate.fieldId === sort.fieldId &&
                    !('bucket' in candidate && candidate.bucket !== undefined)
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
        const rows = sql<Row>`select ${sql.join(selections)} from (${source}) as ${sql.id('a')}
          ${groupClause} ${orderClause} limit ${query.limit} offset ${query.offset}`.compile(db);
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
      return safeTry(function* () {
        if (!isBoundDataQuery(plan.query)) {
          return err(failure('invalid_bound_query', 'Query must be bound by DataQueryDefinition'));
        }
        const relationDefinition = plan.query.definition;
        if (relationDefinition.kind !== 'records' && relationDefinition.kind !== 'aggregate') {
          return err(
            failure('invalid_relation_plan', 'Relation execution requires records or aggregate')
          );
        }
        const targetTables = new Map(plan.sources.map((source) => [source.alias, source.table]));
        const binding = yield* DataQueryRelationBinding.prepare(
          plan.definition,
          plan.rootTable,
          targetTables
        );
        const sourcePlans = new Map(plan.sources.map((source) => [source.alias, source]));
        if (sourcePlans.size !== binding.sources.length) {
          return err(failure('invalid_relation_plan', 'Relation plan is incomplete'));
        }
        // Public relation aliases are arbitrary strings (long, dotted, unicode). They are
        // never SQL identifiers: a private per-source alias keeps PostgreSQL identifier
        // limits and quoting rules out of the public contract.
        const sqlAliases = new Map(
          binding.sources.map((source, index) => [source.alias, `relation_${index}`])
        );
        yield* assertDataQueryAccess({ dependencies: binding.rootDependencies }, plan.rootScope);
        for (const source of binding.sources) {
          const sourcePlan = sourcePlans.get(source.alias);
          if (!sourcePlan) {
            return err(failure('invalid_relation_plan', 'A relation scope is missing'));
          }
          yield* assertDataQueryAccess({ dependencies: source.dependencies }, sourcePlan.scope);
        }
        yield* validateDataQueryFilter(plan.rootTable, plan.query.filter);
        const rootName = yield* (yield* plan.rootTable.dbTableName()).split({
          defaultSchema: 'public',
        });
        // `root` is reserved for the public root source, so a declared relation alias
        // can never shadow the internal root alias.
        const rootAlias = 'root';
        const rootFrom = rootName.schema
          ? sql`${sql.id(rootName.schema, rootName.tableName)} as ${sql.id(rootAlias)}`
          : sql`${sql.id(rootName.tableName)} as ${sql.id(rootAlias)}`;

        const rootFields = new Map<string, Field>();
        const rootColumns = new Map<string, string>();
        for (const dependency of binding.rootDependencies) {
          const field = yield* plan.rootTable.getField(
            (candidate) => candidate.id().toString() === dependency.fieldId
          );
          rootFields.set(dependency.fieldId, field);
          rootColumns.set(dependency.fieldId, yield* (yield* field.dbFieldName()).value());
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

        const relationMetrics: DataQueryRelationAggregate[] =
          relationDefinition.kind === 'records'
            ? relationDefinition.select.filter(
                (projection): projection is DataQueryRelationAggregate =>
                  'statisticFunc' in projection
              )
            : relationDefinition.aggregates.filter(
                (aggregate): aggregate is DataQueryRelationAggregate => 'source' in aggregate
              );
        // Group-level averages need both components per root; the hidden column
        // names are index-based so a long public alias cannot exceed PG limits.
        const metricOrder = new Map(
          relationMetrics.map((metric, index) => [metric.alias, index] as const)
        );
        const metricValueAlias = (metric: DataQueryRelationAggregate): string =>
          `metric_${metricOrder.get(metric.alias)}_value`;
        const metricSumAlias = (metric: DataQueryRelationAggregate): string =>
          `metric_${metricOrder.get(metric.alias)}_sum`;
        const metricCountAlias = (metric: DataQueryRelationAggregate): string =>
          `metric_${metricOrder.get(metric.alias)}_count`;
        const metricsBySource = new Map<string, DataQueryRelationAggregate[]>();
        for (const metric of relationMetrics) {
          const metrics = metricsBySource.get(metric.source) ?? [];
          metrics.push(metric);
          metricsBySource.set(metric.source, metrics);
        }
        const grouped = relationDefinition.kind === 'aggregate';

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
        };
        const sqlSources: SqlSource[] = [];
        for (const source of binding.sources) {
          const sourcePlan = sourcePlans.get(source.alias)!;
          const sqlAlias = sqlAliases.get(source.alias)!;
          const name = yield* (yield* sourcePlan.table.dbTableName()).split({
            defaultSchema: 'public',
          });
          const from = name.schema
            ? sql`${sql.id(name.schema, name.tableName)} as ${sql.id(sqlAlias)}`
            : sql`${sql.id(name.tableName)} as ${sql.id(sqlAlias)}`;
          const fields = new Map<string, Field>();
          const columns = new Map<string, string>();
          for (const dependency of source.dependencies) {
            const field = yield* sourcePlan.table.getField(
              (candidate) => candidate.id().toString() === dependency.fieldId
            );
            fields.set(dependency.fieldId, field);
            columns.set(dependency.fieldId, yield* (yield* field.dbFieldName()).value());
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
          const relationFilter = replaceCurrentUserTagInFilter(
            sourcePlan.table,
            plan.query.relationFilters?.[source.alias],
            context.actorId.toString()
          );
          // Representative/default values were checked at prepare; bound values
          // (notably isNot + dateRange) must satisfy the same contract here.
          yield* validateDataQueryFilter(sourcePlan.table, relationFilter);
          const filterRestriction = relationFilter
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
          // A masked link edge must not reveal membership. The mask belongs to the
          // table that hosts the link (root for the first hop, the parent alias after).
          const parentMasks =
            source.parentAlias === 'root'
              ? rootMasks
              : sqlSources.find((candidate) => candidate.alias === source.parentAlias)?.masks;
          const linkMask = parentMasks?.get(source.linkFieldId);
          const restrictions: RawBuilder<unknown>[] = [];
          if (linkMask) restrictions.push(sql`${linkMask}`);
          if (filterRestriction) restrictions.push(sql`${filterRestriction}`);
          if (restriction) restrictions.push(sql`${restriction}`);
          sqlSources.push({
            alias: source.alias,
            cardinality: source.cardinality,
            sqlAlias,
            from,
            parentAlias: source.parentAlias,
            linkFieldId: source.linkFieldId,
            linkStorage: source.linkStorage,
            fields,
            columns,
            values,
            masks,
            restrictions,
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
          if (source.linkStorage.kind === 'target-fk-many') {
            return sql`${sql.id(source.sqlAlias, source.linkStorage.column)} = ${sql.id(
              parentAlias,
              '__id'
            )}`;
          }
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

        // To-one joins come first: every to-one parent is root or an earlier to-one.
        const joins: RawBuilder<unknown>[] = [];
        for (const source of sqlSources) {
          if (source.cardinality === 'many') continue;
          const parentAlias = parentSqlAlias(source);
          if (!parentAlias) {
            return err(failure('invalid_relation_plan', 'A relation parent source is missing'));
          }
          const linkPredicate =
            source.linkStorage.kind === 'root-fk'
              ? sql`${sql.id(source.sqlAlias, '__id')} = ${sql.id(
                  parentAlias,
                  source.linkStorage.column
                )}`
              : source.linkStorage.kind === 'target-fk'
                ? sql`${sql.id(source.sqlAlias, source.linkStorage.column)} = ${sql.id(
                    parentAlias,
                    '__id'
                  )}`
                : undefined;
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
          const dedupeAlias = 'branch_rows';
          const valueColumns: RawBuilder<unknown>[] = [];
          const selections: RawBuilder<unknown>[] = [];
          for (const metric of metrics) {
            if (metric.statisticFunc === 'count') {
              selections.push(
                sql`count(${sql.id(dedupe ? dedupeAlias : leaf.sqlAlias, '__id')}) as ${sql.id(
                  metric.alias
                )}`
              );
              continue;
            }
            const value = leaf.values.get(metric.fieldId!);
            if (!value) throw new Error('Missing relation aggregate field');
            if (dedupe) {
              valueColumns.push(sql`${value} as ${sql.id(metricValueAlias(metric))}`);
            }
            const column = dedupe ? sql.id(dedupeAlias, metricValueAlias(metric)) : value;
            switch (metric.statisticFunc) {
              case 'unique':
                selections.push(sql`count(distinct ${column}) as ${sql.id(metric.alias)}`);
                break;
              case 'sum':
                selections.push(sql`sum(${column}) as ${sql.id(metric.alias)}`);
                break;
              case 'average':
                if (grouped) {
                  // The group combine needs an exact weighted mean.
                  selections.push(
                    sql`sum(${column}) as ${sql.id(metricSumAlias(metric))}, count(${column}) as ${sql.id(
                      metricCountAlias(metric)
                    )}`
                  );
                } else {
                  selections.push(sql`avg(${column}) as ${sql.id(metric.alias)}`);
                }
                break;
              case 'min':
                selections.push(sql`min(${column}) as ${sql.id(metric.alias)}`);
                break;
              case 'max':
                selections.push(sql`max(${column}) as ${sql.id(metric.alias)}`);
                break;
            }
          }
          const whereClause = sql`where ${sql.join(conditions, sql` and `)}`;
          const body = dedupe
            ? sql`select ${sql.join(selections)} from (
                select distinct ${sql.id(leaf.sqlAlias, '__id')} as ${sql.id('__id')}
                  ${valueColumns.length ? sql`, ${sql.join(valueColumns)}` : sql``}
                from ${sql.join(froms, sql` `)} ${whereClause}
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
        if (filter != null) {
          const condition = yield* buildRecordConditionSpec(
            plan.rootTable,
            filter,
            plan.rootScope.fieldMasks
          );
          const where = yield* buildRecordWhereClause(condition, { tableAlias: rootAlias });
          if (where) predicates.push(sql`${where}`);
        }
        if (plan.rootScope.recordSpec) {
          const where = yield* buildRecordWhereClause(plan.rootScope.recordSpec, {
            tableAlias: rootAlias,
          });
          if (where) predicates.push(sql`${where}`);
        }
        const where = predicates.length ? sql`where ${sql.join(predicates, sql` and `)}` : sql``;

        if (relationDefinition.kind === 'aggregate') {
          const groupSource = (group: object): string => {
            if ('source' in group && typeof group.source === 'string') return group.source;
            return rootAlias;
          };
          const innerSelections: RawBuilder<unknown>[] = [];
          const rootInnerAlias = (fieldId: string) => `root__${fieldId}`;
          const sourceInnerAlias = (index: number, fieldId: string) =>
            `source_${index}__${fieldId}`;
          const rootAggregates = relationDefinition.aggregates.filter(
            (aggregate): aggregate is DataQueryAggregate => !('source' in aggregate)
          );
          const rootIds = new Set<string>([
            ...rootAggregates.map((aggregate) => aggregate.fieldId),
            ...(relationDefinition.groupBy ?? [])
              .filter((group) => groupSource(group) === rootAlias)
              .map((group) => group.fieldId),
          ]);
          for (const fieldId of rootIds) {
            const expression = rootValues.get(fieldId);
            if (!expression) {
              return err(failure('invalid_relation_plan', 'A root field is not bound'));
            }
            innerSelections.push(sql`${expression} as ${sql.id(rootInnerAlias(fieldId))}`);
          }
          for (const [alias, index] of sourceIndexByAlias) {
            const source = sqlSources[index];
            const fieldIds = new Set(
              (relationDefinition.groupBy ?? [])
                .filter((group) => groupSource(group) === alias)
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
          for (const [index, group] of (relationDefinition.groupBy ?? []).entries()) {
            const bucket = 'bucket' in group ? group.bucket : undefined;
            if (bucket === undefined) continue;
            const source = groupSource(group);
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
            ${sql.join([...joins, ...manyLaterals], sql` `)} ${where}`;
          const selections: RawBuilder<unknown>[] = [];
          for (const aggregate of relationDefinition.aggregates) {
            if ('source' in aggregate) {
              if (!aggregateAliases.has(aggregate.source)) {
                return err(failure('invalid_relation_plan', 'A relation metric has no branch'));
              }
              // The inner query already holds one scalar per root; the group
              // combine reads the inner row, never the lateral alias.
              const column = sql.id('b', aggregate.alias);
              switch (aggregate.statisticFunc) {
                case 'count':
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
                    sql`sum(${sql.id('b', metricSumAlias(aggregate))}) / nullif(sum(${sql.id(
                      'b',
                      metricCountAlias(aggregate)
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
            const field = rootFields.get(aggregate.fieldId);
            if (!field) {
              return err(failure('invalid_relation_plan', 'A root aggregate field is not bound'));
            }
            selections.push(
              sql`${buildTableRecordAggregationExpression(
                field,
                rootInnerAlias(aggregate.fieldId),
                aggregate.statisticFunc,
                'b'
              )} as ${sql.id(aggregate.alias)}`
            );
          }
          const groups = new Map<string, RawBuilder<unknown>>();
          for (const group of relationDefinition.groupBy ?? []) {
            const source = groupSource(group);
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
            const group = (relationDefinition.groupBy ?? []).find(
              (candidate) =>
                groupSource(candidate) === rootAlias &&
                candidate.fieldId === sort.fieldId &&
                (!('bucket' in candidate) || candidate.bucket === undefined)
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
          for (const group of relationDefinition.groupBy ?? []) {
            if (
              !orders.length ||
              !plan.query.sort.some((sort) => 'alias' in sort && sort.alias === group.alias)
            ) {
              addOrder(sql.id(group.alias), 'asc');
            }
          }
          const groupClause = groups.size ? sql`group by ${sql.join([...groups.values()])}` : sql``;
          const orderClause = orders.length ? sql`order by ${sql.join(orders)}` : sql``;
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

        const selections = relationDefinition.select.map((projection) => {
          if ('statisticFunc' in projection) {
            const aggregateAlias = aggregateAliases.get(projection.source);
            if (!aggregateAlias) throw new Error('Missing relation aggregate source');
            return sql`${sql.id(aggregateAlias, projection.alias)} as ${sql.id(projection.alias)}`;
          }
          const source = 'source' in projection ? projection.source : undefined;
          const sqlAlias =
            source === undefined || source === 'root' ? rootAlias : sqlAliases.get(source)!;
          if ('system' in projection) {
            const expression = sql`${sql.id(sqlAlias, systemColumns[projection.system])}`;
            return sql`${expression} as ${sql.id(projection.alias)}`;
          }
          const values =
            source === undefined || source === 'root'
              ? rootValues
              : sqlSources.find((candidate) => candidate.alias === source)?.values;
          const stored = values?.get(projection.fieldId);
          if (!stored) throw new Error('Missing relation projection');
          const expression =
            'bucket' in projection && projection.bucket !== undefined
              ? buildBucketExpression(stored, projection.bucket)
              : stored;
          return sql`${
            projection.arrayDistinct === true
              ? buildArrayDistinctExpression(expression)
              : expression
          } as ${sql.id(projection.alias)}`;
        });

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
            addOrder(sql.id(sort.alias), sort.order, false, sort.nulls);
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
          'teable.data_query.kind': plan.query.definition.kind,
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
            const state =
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              typeof error.code === 'string' &&
              /^[0-9A-Z]{5}$/.test(error.code)
                ? error.code
                : undefined;
            return err(
              domainError.infrastructure({
                code: state === '57014' ? 'data_query.timeout' : 'data_query.execution_failed',
                message:
                  state === '57014'
                    ? 'Data query exceeded its statement timeout'
                    : 'Unable to execute data query',
                ...(state ? { details: { sqlState: state } } : {}),
              })
            );
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
        plan.query.definition.kind === 'records'
          ? plan.query.definition.select
              .filter(
                (projection): projection is DataQueryRelationAggregate =>
                  'statisticFunc' in projection
              )
              .map((projection) => [projection.alias, projection.statisticFunc] as const)
          : plan.query.definition.kind === 'aggregate'
            ? plan.query.definition.aggregates.map(
                (aggregate) => [aggregate.alias, aggregate.statisticFunc] as const
              )
            : []
      );
      return ok({
        rows: pages.rows.map((row) => {
          const output: Row = {};
          for (const [alias, value] of Object.entries(row)) {
            output[alias] = normalizeDataQueryValue(value, statistics.get(alias));
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
    scope: RecordQueryPluginScope
  ): Promise<Result<DataQueryResult, DomainError>> {
    const compiled = await traceDataQueryStage(
      context,
      'compile',
      { 'teable.component': 'repository' },
      async () => this.buildQueries(context, table, query, scope)
    );
    if (compiled.isErr()) return err(compiled.error);
    try {
      const read = await traceDataQueryStage(
        context,
        'database.readOnly',
        {
          'teable.component': 'repository',
          'teable.table_id': table.id().toString(),
          'teable.data_query.kind': query.definition.kind,
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
            const state =
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              typeof error.code === 'string' &&
              /^[0-9A-Z]{5}$/.test(error.code)
                ? error.code
                : undefined;
            return err(
              domainError.infrastructure({
                code: state === '57014' ? 'data_query.timeout' : 'data_query.execution_failed',
                message:
                  state === '57014'
                    ? 'Data query exceeded its statement timeout'
                    : 'Unable to execute data query',
                ...(state ? { details: { sqlState: state } } : {}),
              })
            );
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
        (query.definition.kind === 'aggregate' ? query.definition.aggregates : []).map(
          (aggregate) => [aggregate.alias, aggregate.statisticFunc]
        )
      );
      return ok({
        rows: pages.rows.map((row) => {
          const output: Row = {};
          for (const [alias, value] of Object.entries(row)) {
            output[alias] = normalizeDataQueryValue(value, aggregates.get(alias));
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
