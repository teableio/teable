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
            const expression =
              'system' in projection
                ? sql.id('t', systemColumns[projection.system])
                : values.get(projection.fieldId)!;
            return sql`${expression} as ${sql.id(projection.alias)}`;
          });
          for (const sort of snapshot.sort ?? []) {
            if ('system' in sort) {
              addOrder(sql.id('t', systemColumns[sort.system]), sort.order, true);
              continue;
            }
            const clauses = yield* buildStoredFieldOrderByClauses(
              fields.get(sort.fieldId)!,
              columns.get(sort.fieldId)!,
              sort.order,
              't',
              { columnExpression: values.get(sort.fieldId)! }
            );
            for (const clause of clauses)
              addOrder(clause.expression, clause.direction, clause.matchV1Nulls);
          }
          addOrder(sql.id('t', '__id'), 'asc');
          return ok(
            sql<Row>`select ${sql.join(selections)} from ${from} ${where}
            order by ${sql.join(orders)} limit ${query.limit} offset ${query.offset}`.compile(db)
          );
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
              ? buildDateLikeGroupExpression(field, 'a', group.fieldId) ?? column
              : buildUserGroupIdentityExpr(column, multiplicity);
          groups.set(group.fieldId, expression);
          selections.push(sql`${expression} as ${sql.id(group.alias)}`);
        }
        const groupOrders = [...(snapshot.sort ?? [])];
        const orderedIds = new Set(
          groupOrders.flatMap((sort) => ('fieldId' in sort ? [sort.fieldId] : []))
        );
        for (const group of snapshot.groupBy ?? []) {
          if (!orderedIds.has(group.fieldId))
            groupOrders.push({ fieldId: group.fieldId, order: 'asc' });
        }
        for (const sort of groupOrders) {
          if (!('fieldId' in sort) || !groups.has(sort.fieldId)) {
            return err(failure('invalid_sort', 'Aggregate sorting requires a group field'));
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
        return ok(
          sql<Row>`select ${sql.join(selections)} from (${source}) as ${sql.id('a')}
          ${groupClause} ${orderClause} limit ${query.limit} offset ${query.offset}`.compile(db)
        );
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
      async () => this.compile(context, table, query, scope)
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
        },
        async () => {
          try {
            return ok(
              await this.db.transaction().execute(async (transaction) => {
                await sql`set transaction read only`.execute(transaction);
                await sql`select set_config('statement_timeout', ${String(this.statementTimeoutMs)}, true)`.execute(
                  transaction
                );
                return transaction.executeQuery(compiled.value);
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
      const result = read.value;
      const aggregates = new Map(
        (query.definition.kind === 'aggregate' ? query.definition.aggregates : []).map(
          (aggregate) => [aggregate.alias, aggregate.statisticFunc]
        )
      );
      return ok({
        rows: result.rows.map((row) => {
          const output: Row = {};
          for (const [alias, value] of Object.entries(row)) {
            output[alias] = normalizeDataQueryValue(value, aggregates.get(alias));
          }
          return output;
        }),
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
