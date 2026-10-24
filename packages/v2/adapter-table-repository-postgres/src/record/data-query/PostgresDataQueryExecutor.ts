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
  type DataQueryBucket,
  type DataQueryRelationAggregate,
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

        const sourceIds = [
          ...new Set([
            ...snapshot.aggregates.map((aggregate) => aggregate.fieldId),
            ...(snapshot.groupBy ?? []).map((group) => group.fieldId),
          ]),
        ];
        const source = sql`select ${sql.join(
          sourceIds.map((id) => {
            const field = fields.get(id)!;
            const value = values.get(id)!;
            // Historical system-user columns store a plain user ID, not JSON. Normalize
            // after masking, without a fallback that could reveal a masked identity.
            const fieldType = field.type().toString();
            const expression =
              fieldType === 'createdBy' || fieldType === 'lastModifiedBy'
                ? buildUserJsonObjectFromSnapshotExpr(value)
                : value;
            return sql`${expression} as ${sql.id(id)}`;
          })
        )} from ${from} ${where}`;
        const selections = snapshot.aggregates.map(
          (aggregate) =>
            sql`${buildTableRecordAggregationExpression(
              fields.get(aggregate.fieldId)!,
              aggregate.fieldId,
              aggregate.statisticFunc
            )} as ${sql.id(aggregate.alias)}`
        );
        const groups = new Map<string, RawBuilder<unknown>>();
        // A bucket expression carries bound unit/zone/label values. Repeating it in
        // GROUP BY would create distinct placeholders PostgreSQL cannot prove equal,
        // so the row query groups by the projected alias while the total query still
        // needs the full expression (its projection is only `1`).
        const rowGroups = new Map<string, RawBuilder<unknown>>();
        for (const group of snapshot.groupBy ?? []) {
          const field = fields.get(group.fieldId)!;
          const column = sql.ref(`a.${group.fieldId}`);
          const bucket = 'bucket' in group ? group.bucket : undefined;
          let expression: RawBuilder<unknown>;
          if (bucket !== undefined) {
            expression = buildBucketExpression(column, bucket);
          } else {
            const multiplicity = yield* resolveUserGroupIdentityMultiplicity(field);
            expression =
              multiplicity == null
                ? (buildDateLikeGroupExpression(field, 'a', group.fieldId) ?? column)
                : buildUserGroupIdentityExpr(column, multiplicity);
          }
          // A bucketed group has no field-identity ordering; sorting must use its alias.
          const key = bucket === undefined ? group.fieldId : `bucket:${group.alias}`;
          groups.set(key, expression);
          rowGroups.set(key, bucket === undefined ? expression : sql.id(group.alias));
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
          if (!orderedIds.has(group.fieldId))
            groupOrders.push({ fieldId: group.fieldId, order: 'asc' });
        }
        for (const sort of groupOrders) {
          if ('alias' in sort) {
            // The alias is the selected output column; sorting never re-evaluates the aggregate.
            addOrder(sql.id(sort.alias), sort.order, true, sort.nulls);
            continue;
          }
          if (!('fieldId' in sort) || !groups.has(sort.fieldId)) {
            return err(
              failure('invalid_sort', 'Aggregate sorting requires a group field or alias')
            );
          }
          const expression = groups.get(sort.fieldId)!;
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
        const rowGroupClause = rowGroups.size
          ? sql`group by ${sql.join([...rowGroups.values()])}`
          : sql``;
        const orderClause = orders.length ? sql`order by ${sql.join(orders)}` : sql``;
        const rows = sql<Row>`select ${sql.join(selections)} from (${source}) as ${sql.id('a')}
          ${rowGroupClause} ${orderClause} limit ${query.limit} offset ${query.offset}`.compile(db);
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

        type SqlSource = {
          readonly alias: string;
          readonly cardinality: 'one' | 'many';
          readonly sqlAlias: string;
          readonly fields: Map<string, Field>;
          readonly columns: Map<string, string>;
          readonly values: Map<string, RawBuilder<unknown>>;
          /** Parent-scoped mask expressions; a child hop ANDs its link-edge mask. */
          readonly masks?: ReadonlyMap<string, Expression<SqlBool>>;
          /** Present for a to-many source: the one-row pre-aggregated lateral. */
          readonly aggregateAlias?: string;
        };
        const sqlSources: SqlSource[] = [];
        const joins: RawBuilder<unknown>[] = [];
        for (const [index, source] of binding.sources.entries()) {
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
          // A join may only read a source that was joined before it. `via` is
          // validated to name an earlier alias, so declaration order is join order.
          const parentAlias =
            source.parentAlias === 'root' ? rootAlias : sqlAliases.get(source.parentAlias);
          if (!parentAlias) {
            return err(failure('invalid_relation_plan', 'A relation parent source is missing'));
          }
          const relationFilter = replaceCurrentUserTagInFilter(
            sourcePlan.table,
            plan.query.relationFilters?.[source.alias],
            context.actorId.toString()
          );
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

          if (source.cardinality === 'many') {
            if (relationDefinition.kind !== 'records') {
              return err(
                failure('invalid_relation_plan', 'A to-many source requires a records definition')
              );
            }
            const aggregateAlias = `aggregate_${index}`;
            const aggregates = relationDefinition.select.filter(
              (projection): projection is DataQueryRelationAggregate =>
                'statisticFunc' in projection && projection.source === source.alias
            );
            if (aggregates.length === 0) {
              // Declared but unused: no lateral join is needed.
              sqlSources.push({
                alias: source.alias,
                cardinality: source.cardinality,
                sqlAlias,
                fields,
                columns,
                values,
              });
              continue;
            }
            const membership =
              source.linkStorage.kind === 'target-fk-many'
                ? sql`${sql.id(sqlAlias, source.linkStorage.column)} = ${sql.id(
                    parentAlias,
                    '__id'
                  )}`
                : source.linkStorage.kind === 'junction'
                  ? (() => {
                      const junctionAlias = `junction_${index}`;
                      const junctionFrom = source.linkStorage.schema
                        ? sql`${sql.id(
                            source.linkStorage.schema,
                            source.linkStorage.tableName
                          )} as ${sql.id(junctionAlias)}`
                        : sql`${sql.id(source.linkStorage.tableName)} as ${sql.id(junctionAlias)}`;
                      return sql`exists (
                        select 1 from ${junctionFrom}
                        where ${sql.id(junctionAlias, source.linkStorage.selfKeyName)} = ${sql.id(
                          parentAlias,
                          '__id'
                        )}
                          and ${sql.id(
                            junctionAlias,
                            source.linkStorage.foreignKeyName
                          )} = ${sql.id(sqlAlias, '__id')}
                      )`;
                    })()
                  : undefined;
            if (!membership) {
              return err(failure('join_storage', 'A to-many relation has no physical storage'));
            }
            const conditions: RawBuilder<unknown>[] = [membership];
            if (linkMask) conditions.push(sql`${linkMask}`);
            if (filterRestriction) conditions.push(sql`${filterRestriction}`);
            if (restriction) conditions.push(sql`${restriction}`);
            const aggregateSelections = aggregates.map((aggregate) => {
              if (aggregate.statisticFunc === 'count') {
                // Count related records, not joined rows: an unlinked parent is 0.
                return sql`count(${sql.id(sqlAlias, '__id')}) as ${sql.id(aggregate.alias)}`;
              }
              const value = values.get(aggregate.fieldId!);
              if (!value) throw new Error('Missing relation aggregate field');
              switch (aggregate.statisticFunc) {
                case 'unique':
                  return sql`count(distinct ${value}) as ${sql.id(aggregate.alias)}`;
                case 'sum':
                  return sql`sum(${value}) as ${sql.id(aggregate.alias)}`;
                case 'average':
                  return sql`avg(${value}) as ${sql.id(aggregate.alias)}`;
                case 'min':
                  return sql`min(${value}) as ${sql.id(aggregate.alias)}`;
                case 'max':
                  return sql`max(${value}) as ${sql.id(aggregate.alias)}`;
              }
            });
            // One row per parent key, so the root result keeps its row shape and
            // offset/total semantics; target filters and row scope stay inside.
            joins.push(
              sql`left join lateral (select ${sql.join(
                aggregateSelections
              )} from ${from} where ${sql.join(conditions, sql` and `)}) as ${sql.id(
                aggregateAlias
              )} on true`
            );
            sqlSources.push({
              alias: source.alias,
              cardinality: source.cardinality,
              sqlAlias,
              fields,
              columns,
              values,
              masks,
              aggregateAlias,
            });
            continue;
          }

          const linkPredicate =
            source.linkStorage.kind === 'root-fk'
              ? sql`${sql.id(sqlAlias, '__id')} = ${sql.id(parentAlias, source.linkStorage.column)}`
              : source.linkStorage.kind === 'target-fk'
                ? sql`${sql.id(sqlAlias, source.linkStorage.column)} = ${sql.id(
                    parentAlias,
                    '__id'
                  )}`
                : undefined;
          if (!linkPredicate) {
            return err(failure('join_storage', 'A to-one relation has no physical storage'));
          }
          const joinCondition: RawBuilder<unknown>[] = [linkPredicate];
          if (linkMask) joinCondition.push(sql`${linkMask}`);
          if (filterRestriction) joinCondition.push(sql`${filterRestriction}`);
          if (restriction) joinCondition.push(sql`${restriction}`);
          joins.push(sql`left join ${from} on ${sql.join(joinCondition, sql` and `)}`);
          sqlSources.push({
            alias: source.alias,
            cardinality: source.cardinality,
            sqlAlias,
            fields,
            columns,
            values,
            masks,
          });
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
          const sourceIndex = new Map(
            sqlSources.map((candidate, index) => [candidate.alias, index])
          );
          const innerSelections: RawBuilder<unknown>[] = [];
          const rootInnerAlias = (fieldId: string) => `root__${fieldId}`;
          const sourceInnerAlias = (index: number, fieldId: string) =>
            `source_${index}__${fieldId}`;
          const rootIds = new Set<string>([
            ...relationDefinition.aggregates.map((aggregate) => aggregate.fieldId),
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
          for (const [alias, index] of sourceIndex) {
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
          const inner = sql`select ${sql.join(innerSelections)} from ${rootFrom}
            ${sql.join(joins, sql` `)} ${where}`;
          const selections = relationDefinition.aggregates.map(
            (aggregate) =>
              sql`${buildTableRecordAggregationExpression(
                rootFields.get(aggregate.fieldId)!,
                rootInnerAlias(aggregate.fieldId),
                aggregate.statisticFunc,
                'b'
              )} as ${sql.id(aggregate.alias)}`
          );
          const groups = new Map<string, RawBuilder<unknown>>();
          const rowGroups = new Map<string, RawBuilder<unknown>>();
          for (const group of relationDefinition.groupBy ?? []) {
            const source = groupSource(group);
            const sourcePosition = source === rootAlias ? undefined : sourceIndex.get(source);
            if (source !== rootAlias && sourcePosition === undefined) {
              return err(failure('invalid_relation_plan', 'A group source is missing'));
            }
            const columnName =
              source === rootAlias
                ? rootInnerAlias(group.fieldId)
                : sourceInnerAlias(sourcePosition!, group.fieldId);
            const column = sql.ref(`b.${columnName}`);
            const bucket = 'bucket' in group ? group.bucket : undefined;
            const groupField =
              source === rootAlias
                ? rootFields.get(group.fieldId)!
                : sqlSources[sourcePosition!].fields.get(group.fieldId)!;
            let expression: RawBuilder<unknown>;
            if (bucket !== undefined) {
              expression = buildBucketExpression(column, bucket);
            } else {
              const multiplicity = yield* resolveUserGroupIdentityMultiplicity(groupField);
              expression =
                multiplicity == null
                  ? (buildDateLikeGroupExpression(groupField, 'b', columnName) ?? column)
                  : buildUserGroupIdentityExpr(column, multiplicity);
            }
            // Every group is keyed by its output alias; a field-id sort resolves
            // the alias instead of assuming alias == fieldId.
            const key = `group:${group.alias}`;
            groups.set(key, expression);
            rowGroups.set(key, bucket === undefined ? expression : sql.id(group.alias));
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
          const rowGroupClause = rowGroups.size
            ? sql`group by ${sql.join([...rowGroups.values()])}`
            : sql``;
          const countGroupClause = groups.size
            ? sql`group by ${sql.join([...groups.values()])}`
            : sql``;
          const orderClause = orders.length ? sql`order by ${sql.join(orders)}` : sql``;
          const rows = sql<Row>`select ${sql.join(selections)} from (${inner}) as ${sql.id('b')}
            ${rowGroupClause} ${orderClause} limit ${plan.query.limit} offset ${plan.query.offset}`.compile(
            db
          );
          if (!plan.query.includeTotal) return ok({ rows });
          if (!groups.size) return ok({ rows, constantTotal: 1 });
          const count = sql<{
            total: unknown;
          }>`select count(*) as ${sql.id('total')} from (
            select 1 from (${inner}) as ${sql.id('b')} ${countGroupClause}
          ) as ${sql.id('grouped')}`.compile(db);
          return ok({ rows, count });
        }

        const selections = relationDefinition.select.map((projection) => {
          if ('statisticFunc' in projection) {
            const target = sqlSources.find((candidate) => candidate.alias === projection.source);
            if (!target?.aggregateAlias) throw new Error('Missing relation aggregate source');
            return sql`${sql.id(target.aggregateAlias, projection.alias)} as ${sql.id(
              projection.alias
            )}`;
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
          ${sql.join(joins, sql` `)} ${where}
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
