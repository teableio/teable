import {
  AndSpec,
  domainError,
  FieldId,
  FieldType,
  type DomainError,
  type ITableRecordConditionSpecVisitor,
  type ISpecification,
  type Table,
  type TableRecord,
} from '@teable/v2-core';
import { sql, type AliasedRawBuilder, type Expression, type Kysely, type SqlBool } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok, safeTry } from 'neverthrow';

import { TableRecordConditionWhereVisitor } from '../../visitors';
import type {
  DynamicDB,
  IQueryBuilderDeps,
  ITableRecordQueryBuilder,
  OrderByColumn,
  QB,
} from '../ITableRecordQueryBuilder';
import type { QueryMode } from '../TableRecordQueryBuilderManager';
import { StoredFieldSelectVisitor } from './StoredFieldSelectVisitor';

const T = 't'; // main table alias

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
  private orderByValues: Array<{ column: OrderByColumn; direction: 'asc' | 'desc' }> = [];
  private whereSpecs: Array<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>> = [];

  readonly mode: QueryMode = 'stored';

  constructor(private readonly db: Kysely<DynamicDB>) {}

  from(table: Table): this {
    this.table = table;
    return this;
  }

  select(projection: ReadonlyArray<FieldId>): this {
    this.projection = projection;
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

  orderBy(column: OrderByColumn, direction: 'asc' | 'desc'): this {
    this.orderByValues.push({ column, direction });
    return this;
  }

  where(spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>): this {
    this.whereSpecs.push(spec);
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
        const tableName = yield* dbTableName.value();

        const selectColumns = yield* this.buildSelectColumns(table, projection);

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

        // Resolve orderBy columns
        const resolvedOrderBy: Array<{ column: string; direction: 'asc' | 'desc' }> = [];
        for (const orderBy of this.orderByValues) {
          const columnResult = yield* this.resolveOrderByColumn(table, orderBy.column);
          if (columnResult !== null) {
            resolvedOrderBy.push({ column: columnResult, direction: orderBy.direction });
          }
        }

        const whereClauseResult = this.buildWhereCondition();
        if (whereClauseResult.isErr()) {
          return err(whereClauseResult.error);
        }
        const whereClause = whereClauseResult.value;
        let query = this.db
          .selectFrom(`${tableName} as ${T}`)
          .select(() => [
            idColumn,
            versionColumn,
            autoNumberColumn,
            createdTimeColumn,
            createdByColumn,
            lastModifiedTimeColumn,
            lastModifiedByColumn,
            ...selectColumns,
          ])
          .$if(whereClause !== null, (qb) =>
            qb.where(whereClause as unknown as Expression<SqlBool>)
          );

        for (const orderBy of resolvedOrderBy) {
          query = query.orderBy(sql`${sql.ref(`${T}.${orderBy.column}`)}`, orderBy.direction);
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

  /**
   * Resolve orderBy column to actual database column name.
   * If FieldId, look up the field's dbFieldName.
   * If system column string, use as-is.
   */
  private resolveOrderByColumn(
    table: Table,
    orderByColumn: OrderByColumn
  ): Result<string | null, DomainError> {
    // If it's a FieldId, resolve to dbFieldName
    if (orderByColumn instanceof FieldId) {
      return table
        .getField((f) => f.id().equals(orderByColumn as FieldId))
        .andThen((field) => {
          const fieldType = field.type();
          if (fieldType.equals(FieldType.createdTime())) return ok('__created_time');
          if (fieldType.equals(FieldType.lastModifiedTime())) return ok('__last_modified_time');
          if (fieldType.equals(FieldType.createdBy())) return ok('__created_by');
          if (fieldType.equals(FieldType.lastModifiedBy())) return ok('__last_modified_by');
          if (fieldType.equals(FieldType.autoNumber())) return ok('__auto_number');
          return field.dbFieldName().andThen((dbFieldName) => dbFieldName.value());
        });
    }

    // System column - use as-is
    return ok(orderByColumn);
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
