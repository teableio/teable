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

type ResolvedOrderBy = {
  column: string;
  direction: 'asc' | 'desc';
  userLikeMode?: 'single' | 'multiple';
};

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
        const resolvedOrderBy: ResolvedOrderBy[] = [];
        for (const orderBy of this.orderByValues) {
          const resolved = yield* this.resolveOrderBy(table, orderBy.column, orderBy.direction);
          if (resolved !== null) {
            resolvedOrderBy.push(resolved);
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
          if (orderBy.userLikeMode) {
            query = this.applyUserLikeOrderBy(
              query,
              orderBy.column,
              orderBy.direction,
              orderBy.userLikeMode
            );
          } else {
            // Align null ordering with v1: ASC => nulls first, DESC => nulls last.
            // Without this, PostgreSQL defaults to ASC NULLS LAST / DESC NULLS FIRST,
            // which is the opposite of v1, causing row offset mismatches during paste.
            const columnRef = sql`${sql.ref(`${T}.${orderBy.column}`)}`;
            const nullOrderDirection: 'asc' | 'desc' = orderBy.direction === 'asc' ? 'desc' : 'asc';
            query = query
              .orderBy(sql`${columnRef} is null`, nullOrderDirection)
              .orderBy(columnRef, orderBy.direction);
          }
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
    direction: 'asc' | 'desc'
  ): Result<ResolvedOrderBy | null, DomainError> {
    if (orderByColumn instanceof FieldId) {
      return table
        .getField((f) => f.id().equals(orderByColumn as FieldId))
        .andThen((field) => {
          const fieldType = field.type();
          const isUserLike =
            fieldType.equals(FieldType.user()) ||
            fieldType.equals(FieldType.link()) ||
            fieldType.equals(FieldType.createdBy()) ||
            fieldType.equals(FieldType.lastModifiedBy());

          if (fieldType.equals(FieldType.createdTime())) {
            return ok({ column: '__created_time', direction });
          }
          if (fieldType.equals(FieldType.lastModifiedTime())) {
            return ok({ column: '__last_modified_time', direction });
          }
          if (fieldType.equals(FieldType.createdBy())) {
            return ok({ column: '__created_by', direction, userLikeMode: 'single' });
          }
          if (fieldType.equals(FieldType.lastModifiedBy())) {
            return ok({ column: '__last_modified_by', direction, userLikeMode: 'single' });
          }
          if (fieldType.equals(FieldType.autoNumber())) {
            return ok({ column: '__auto_number', direction });
          }

          return field.dbFieldName().andThen((dbFieldName) =>
            dbFieldName.value().map((column) => ({
              column,
              direction,
              ...(isUserLike
                ? {
                    userLikeMode: (field.isMultipleCellValue() ? 'multiple' : 'single') as Exclude<
                      ResolvedOrderBy['userLikeMode'],
                      undefined
                    >,
                  }
                : {}),
            }))
          );
        });
    }

    return ok({ column: orderByColumn, direction });
  }

  /**
   * Align user/link ordering with v1:
   * - single: sort by `title`
   * - multiple: sort by `titles[]` text projection
   * - null ordering: ASC => null first, DESC => null last
   */
  private applyUserLikeOrderBy(
    query: QB,
    column: string,
    direction: 'asc' | 'desc',
    mode: 'single' | 'multiple'
  ): QB {
    const columnRef = sql.ref(`${T}.${column}`);
    const columnJson = sql`to_jsonb(${columnRef})`;
    const titleExpr =
      mode === 'multiple'
        ? sql`jsonb_path_query_array(CASE WHEN jsonb_typeof(${columnJson}) = 'array' THEN ${columnJson} ELSE '[]'::jsonb END, '$[*].title')::text`
        : sql`coalesce(${columnJson} ->> 'title', ${columnJson} ->> 'name', ${columnJson} #>> '{}')`;

    const nullOrderDirection: 'asc' | 'desc' = direction === 'asc' ? 'desc' : 'asc';

    return query
      .orderBy(sql`${titleExpr} is null`, nullOrderDirection)
      .orderBy(titleExpr, direction);
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
