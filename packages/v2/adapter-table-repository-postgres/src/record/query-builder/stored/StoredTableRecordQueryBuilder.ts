import {
  AndSpec,
  domainError,
  FieldId,
  FieldType,
  type DomainError,
  type Field,
  type ITableRecordConditionSpecVisitor,
  type ISpecification,
  type Table,
  type TableRecord,
} from '@teable/v2-core';
import {
  sql,
  type AliasedRawBuilder,
  type Expression,
  type Kysely,
  type RawBuilder,
  type SqlBool,
} from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok, safeTry } from 'neverthrow';

import { TableRecordConditionWhereVisitor } from '../../visitors';
import type {
  DynamicDB,
  FieldMaskSqlMap,
  IQueryBuilderDeps,
  ITableRecordQueryBuilder,
  OrderByColumn,
  QB,
} from '../ITableRecordQueryBuilder';
import { maskValueExpression } from '../maskValueExpression';
import { isNeverNullSystemOrderColumn, uniqueOrderByEntries } from '../systemOrderColumns';
import type { QueryMode } from '../TableRecordQueryBuilderManager';
import {
  applyStoredFieldOrderByClause,
  buildStoredFieldOrderByClauses,
  type StoredFieldOrderByClause,
} from './storedFieldOrderBy';
import { StoredFieldSelectVisitor } from './StoredFieldSelectVisitor';
import { buildStoredFieldValueExpression } from './storedFieldValueExpression';

const T = 't'; // main table alias

type ResolvedOrderBy = {
  column: string;
  direction: 'asc' | 'desc';
  clauses?: ReadonlyArray<StoredFieldOrderByClause>;
};

export interface IStoredQueryBuilderOptions {
  sourceTableName?: string;
}

/**
 * Query builder that selects all stored column values directly.
 * No LATERAL joins, no formula computation - just raw column selection.
 * Used for fast reads when pre-computed values are acceptable.
 */
export class StoredTableRecordQueryBuilder implements ITableRecordQueryBuilder {
  private table: Table | null = null;
  private projection: ReadonlyArray<FieldId> | null = null;
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private orderByValues: Array<{
    column: OrderByColumn;
    direction: 'asc' | 'desc';
    groupIdentityCollation?: boolean;
  }> = [];
  private whereSpecs: Array<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>> = [];
  private whereExpressions: Array<Expression<SqlBool>> = [];
  private idsOnlyValue = false;
  private valuesOnlyValue = false;
  private readonly sourceTableName?: string;
  private fieldMaskSqlMapValue: FieldMaskSqlMap | undefined;

  readonly mode: QueryMode = 'stored';

  constructor(
    private readonly db: Kysely<DynamicDB>,
    options?: IStoredQueryBuilderOptions
  ) {
    this.sourceTableName = options?.sourceTableName;
  }

  from(table: Table): this {
    this.table = table;
    return this;
  }

  select(projection: ReadonlyArray<FieldId>): this {
    this.projection = projection;
    return this;
  }

  idsOnly(): this {
    this.idsOnlyValue = true;
    return this;
  }

  valuesOnly(): this {
    this.valuesOnlyValue = true;
    return this;
  }
  fieldMaskSql(maskSqlMap: FieldMaskSqlMap | undefined): this {
    this.fieldMaskSqlMapValue = maskSqlMap;
    return this;
  }

  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  offset(n: number): this {
    this.offsetValue = n;
    return this;
  }

  orderBy(
    column: OrderByColumn,
    direction: 'asc' | 'desc',
    options?: { readonly groupIdentityCollation?: boolean }
  ): this {
    this.orderByValues.push({
      column,
      direction,
      groupIdentityCollation: options?.groupIdentityCollation,
    });
    return this;
  }

  where(spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>): this {
    this.whereSpecs.push(spec);
    return this;
  }

  whereExpression(expression: Expression<SqlBool>): this {
    this.whereExpressions.push(expression);
    return this;
  }

  /**
   * No preparation needed for stored builder - reads pre-stored values.
   */
  async prepare(_deps: IQueryBuilderDeps): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  build(): Result<QB, DomainError> {
    if (!this.table) {
      return err(domainError.validation({ message: 'Call from() first' }));
    }

    const table = this.table;
    const projection = this.projection;

    return safeTry<QB, DomainError>(
      function* (this: StoredTableRecordQueryBuilder) {
        const dbTableName = yield* table.dbTableName();
        const tableName = this.sourceTableName ?? (yield* dbTableName.value());

        const selectColumns = this.idsOnlyValue
          ? []
          : yield* this.buildSelectColumns(table, projection);

        // Always include __id column for record identification
        const idColumn = sql`${sql.ref(`${T}.__id`)}`.as('__id');

        // Always include __version column for realtime sync
        const versionColumn = sql`${sql.ref(`${T}.__version`)}`.as('__version');

        // Include system columns for undo/redo support
        const autoNumberColumn = sql`${sql.ref(`${T}.__auto_number`)}`.as('__auto_number');
        const createdTimeColumn = sql`${sql.ref(`${T}.__created_time`)}`.as('__created_time');
        const createdByColumn = sql`${sql.ref(`${T}.__created_by`)}`.as('__created_by');
        const lastModifiedTimeColumn = sql`${sql.ref(`${T}.__last_modified_time`)}`.as(
          '__last_modified_time'
        );
        const lastModifiedByColumn = sql`${sql.ref(`${T}.__last_modified_by`)}`.as(
          '__last_modified_by'
        );

        const payloadColumns = this.valuesOnlyValue
          ? [idColumn, ...selectColumns]
          : [
              idColumn,
              versionColumn,
              autoNumberColumn,
              createdTimeColumn,
              createdByColumn,
              lastModifiedTimeColumn,
              lastModifiedByColumn,
              ...selectColumns,
            ];

        // Resolve orderBy columns
        const resolvedOrderBy: ResolvedOrderBy[] = [];
        for (const orderBy of uniqueOrderByEntries(this.orderByValues)) {
          const resolved = yield* this.resolveOrderBy(
            table,
            orderBy.column,
            orderBy.direction,
            orderBy.groupIdentityCollation
          );
          if (resolved !== null) {
            resolvedOrderBy.push(resolved);
          }
        }

        const whereClauseResult = this.buildWhereCondition();
        if (whereClauseResult.isErr()) {
          return err(whereClauseResult.error);
        }
        const whereClause = whereClauseResult.value;

        // Flatten all ordering into clauses up-front so both the direct query
        // and the narrow page-selection subquery can share them.
        const resolvedClauses: StoredFieldOrderByClause[] = [];
        for (const orderBy of resolvedOrderBy) {
          if (orderBy.clauses) {
            resolvedClauses.push(...orderBy.clauses);
          } else if (isNeverNullSystemOrderColumn(orderBy.column)) {
            // __auto_number/__id/__version are NOT NULL. A leading
            // `(col IS NULL)` sort key cannot change order and prevents
            // PostgreSQL from using the btree as an ordered scan.
            resolvedClauses.push({
              expression: sql.ref(`${T}.${orderBy.column}`),
              direction: orderBy.direction,
            });
          } else {
            // Align null ordering with v1: ASC => nulls first, DESC => nulls last.
            // Native NULLS modifiers keep paste offsets identical without a
            // leading `(col IS NULL)` key that doubles the sort list.
            resolvedClauses.push({
              expression: sql.ref(`${T}.${orderBy.column}`),
              direction: orderBy.direction,
              matchV1Nulls: true,
            });
          }
        }

        const applyConditions = (qb: QB): QB => {
          let next = qb;
          if (whereClause !== null) {
            next = next.where(whereClause as unknown as Expression<SqlBool>);
          }
          for (const expression of this.whereExpressions) {
            next = next.where(expression);
          }
          return next;
        };

        // A paged + ordered read over a wide row (dozens of text/jsonb columns)
        // makes PostgreSQL evaluate the full target list for every scanned row
        // and sort the wide tuples, spilling to disk on large tables. Select
        // the page ids through a narrow subquery first, then join back for the
        // payload and re-apply the ordering on the page rows only.
        if (this.limitValue !== null && resolvedClauses.length > 0) {
          let pageQuery = applyConditions(
            this.db
              .selectFrom(`${tableName} as ${T}`)
              .select(sql`${sql.ref(`${T}.__id`)}`.as('__id')) as unknown as QB
          );
          for (const clause of resolvedClauses) {
            pageQuery = applyStoredFieldOrderByClause(pageQuery, clause);
          }
          pageQuery = pageQuery
            .limit(this.limitValue)
            .$if(this.offsetValue !== null, (qb) => qb.offset(this.offsetValue!));

          // Ids-only reads ARE the narrow page subquery — no payload join.
          if (this.idsOnlyValue) {
            return ok(pageQuery);
          }

          let query = this.db
            .selectFrom(`${tableName} as ${T}`)
            .innerJoin(pageQuery.as('__page'), '__page.__id', `${T}.__id`)
            .select(() => payloadColumns) as unknown as QB;
          for (const clause of resolvedClauses) {
            query = applyStoredFieldOrderByClause(query, clause);
          }
          return ok(query);
        }

        let query = applyConditions(
          this.db
            .selectFrom(`${tableName} as ${T}`)
            .select(this.idsOnlyValue ? () => [idColumn] : () => payloadColumns) as unknown as QB
        );
        for (const clause of resolvedClauses) {
          query = applyStoredFieldOrderByClause(query, clause);
        }
        query = query
          .$if(this.limitValue !== null, (qb) => qb.limit(this.limitValue!))
          .$if(this.offsetValue !== null, (qb) => qb.offset(this.offsetValue!));
        return ok(query);
      }.bind(this)
    );
  }

  private buildSelectColumns(
    table: Table,
    projection: ReadonlyArray<FieldId> | null
  ): Result<AliasedRawBuilder<unknown, string>[], DomainError> {
    return safeTry(function* () {
      const visitor = new StoredFieldSelectVisitor(T);
      const columns: AliasedRawBuilder<unknown, string>[] = [];

      for (const field of table.getFields()) {
        if (projection && !projection.some((p) => p.toString() === field.id().toString())) {
          continue;
        }
        columns.push(yield* field.accept(visitor));
      }

      return ok(columns);
    });
  }

  private resolveOrderBy(
    table: Table,
    orderByColumn: OrderByColumn,
    direction: 'asc' | 'desc',
    groupIdentityCollation?: boolean
  ): Result<ResolvedOrderBy | null, DomainError> {
    if (orderByColumn instanceof FieldId) {
      return table
        .getField((f) => f.id().equals(orderByColumn as FieldId))
        .andThen((field) => {
          const fieldType = field.type();
          const isTrackAll =
            'isTrackAll' in field && typeof field.isTrackAll === 'function'
              ? field.isTrackAll() === true
              : true;
          const systemColumn = fieldType.equals(FieldType.createdTime())
            ? '__created_time'
            : fieldType.equals(FieldType.lastModifiedTime()) && isTrackAll
              ? '__last_modified_time'
              : fieldType.equals(FieldType.createdBy())
                ? '__created_by'
                : fieldType.equals(FieldType.lastModifiedBy()) && isTrackAll
                  ? '__last_modified_by'
                  : fieldType.equals(FieldType.autoNumber())
                    ? '__auto_number'
                    : undefined;
          const columnResult = systemColumn
            ? ok(systemColumn)
            : field.dbFieldName().andThen((dbFieldName) => dbFieldName.value());
          return columnResult.andThen((column) =>
            buildStoredFieldValueExpression(field, T, column).andThen(
              ({ expression, usesErrorFallback }) =>
                buildStoredFieldOrderByClauses(field, column, direction, T, {
                  columnExpression: this.maskedOrderColumnExpression(
                    field,
                    column,
                    expression,
                    usesErrorFallback
                  ),
                  groupIdentityCollation,
                }).map((clauses) => ({
                  column,
                  direction,
                  clauses,
                }))
            )
          );
        });
    }

    return ok({ column: orderByColumn, direction });
  }

  /**
   * ORDER BY over the masked value domain (T6997): a masked field sorts by
   * `CASE WHEN <visibleWhen> THEN <value> ELSE NULL END` so restricted cells
   * behave as NULL instead of rejecting the query.
   */
  private maskedOrderColumnExpression(
    field: Field,
    column: string,
    expression: RawBuilder<unknown>,
    usesErrorFallback: boolean
  ): RawBuilder<unknown> | undefined {
    const baseExpression = usesErrorFallback ? expression : undefined;
    const maskSql = this.fieldMaskSqlMapValue?.get(field.id().toString());
    if (!maskSql) {
      return baseExpression;
    }
    return maskValueExpression(maskSql, baseExpression ?? sql.ref(`${T}.${column}`));
  }

  private buildWhereCondition(): Result<Expression<SqlBool> | null, DomainError> {
    if (this.whereSpecs.length === 0) {
      return ok(null);
    }

    let combinedSpec = this.whereSpecs[0];
    for (let i = 1; i < this.whereSpecs.length; i += 1) {
      combinedSpec = new AndSpec(combinedSpec, this.whereSpecs[i]);
    }

    const visitor = new TableRecordConditionWhereVisitor({ tableAlias: T });
    const acceptResult = combinedSpec.accept(visitor);
    if (acceptResult.isErr()) {
      return err(acceptResult.error);
    }
    const whereResult = visitor.where();
    if (whereResult.isErr()) {
      return err(whereResult.error);
    }
    return ok(whereResult.value as unknown as Expression<SqlBool>);
  }
}
