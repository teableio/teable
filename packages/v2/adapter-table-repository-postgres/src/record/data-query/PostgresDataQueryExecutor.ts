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
  isBoundDataQuery,
  traceDataQueryStage,
  validateDataQueryFilter,
  type BoundDataQuery,
  type DataQueryResult,
  type DataQuerySystemField,
  type IDataQueryExecutor,
} from '@teable/v2-data-query';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type CompiledQuery, type Kysely, type RawBuilder } from 'kysely';
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
          matchNulls = false
        ) => {
          orders.push(
            direction === 'asc'
              ? matchNulls
                ? sql`${expression} asc nulls first`
                : sql`${expression} asc`
              : matchNulls
                ? sql`${expression} desc nulls last`
                : sql`${expression} desc`
          );
        };
        if (snapshot.kind === 'records') {
          const selections = snapshot.select.map((projection) => {
            if ('system' in projection) {
              return sql`${sql.id('t', systemColumns[projection.system])} as ${sql.id(
                projection.alias
              )}`;
            }
            const expression = values.get(projection.fieldId)!;
            return sql`${
              projection.arrayDistinct === true
                ? buildArrayDistinctExpression(expression)
                : expression
            } as ${sql.id(projection.alias)}`;
          });
          for (const sort of query.sort) {
            if ('system' in sort) {
              addOrder(sql.id('t', systemColumns[sort.system]), sort.order, true);
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
            for (const clause of clauses)
              addOrder(clause.expression, clause.direction, clause.matchV1Nulls);
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
        for (const group of snapshot.groupBy ?? []) {
          const field = fields.get(group.fieldId)!;
          const column = sql.ref(`a.${group.fieldId}`);
          const multiplicity = yield* resolveUserGroupIdentityMultiplicity(field);
          const expression =
            multiplicity == null
              ? (buildDateLikeGroupExpression(field, 'a', group.fieldId) ?? column)
              : buildUserGroupIdentityExpr(column, multiplicity);
          groups.set(group.fieldId, expression);
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
            addOrder(sql.id(sort.alias), sort.order, true);
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
          for (const clause of clauses)
            addOrder(clause.expression, clause.direction, clause.matchV1Nulls);
          // Display ordering may have ties (select-choice order or link titles).
          addOrder(expression, sort.order, true);
        }
        const groupClause = groups.size ? sql`group by ${sql.join([...groups.values()])}` : sql``;
        const orderClause = orders.length ? sql`order by ${sql.join(orders)}` : sql``;
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
