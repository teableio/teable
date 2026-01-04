import { domainError, FieldId, type DomainError, type Table } from '@teable/v2-core';
import { sql, type AliasedRawBuilder, type Kysely } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok, safeTry } from 'neverthrow';

import type {
  DynamicDB,
  IQueryBuilderDeps,
  ITableRecordQueryBuilder,
  OrderByColumn,
  QB,
} from '../ITableRecordQueryBuilder';
import { QueryMode } from '../TableRecordQueryBuilderManager';
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
  private orderByColumnValue: OrderByColumn | null = null;
  private orderByDirection: 'asc' | 'desc' = 'asc';

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
    this.orderByColumnValue = column;
    this.orderByDirection = direction;
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

        // Resolve orderBy column name
        const orderByColumn = yield* this.resolveOrderByColumn(table);

        const query = this.db
          .selectFrom(`${tableName} as ${T}`)
          .select(() => [idColumn, ...selectColumns])
          .$if(orderByColumn !== null, (qb) =>
            qb.orderBy(sql`${sql.ref(`${T}.${orderByColumn}`)}`, this.orderByDirection)
          )
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
  private resolveOrderByColumn(table: Table): Result<string | null, DomainError> {
    if (this.orderByColumnValue === null) {
      return ok(null);
    }

    // If it's a FieldId, resolve to dbFieldName
    if (this.orderByColumnValue instanceof FieldId) {
      return table
        .getField((f) => f.id().equals(this.orderByColumnValue as FieldId))
        .andThen((field) => field.dbFieldName())
        .andThen((dbFieldName) => dbFieldName.value());
    }

    // System column - use as-is
    return ok(this.orderByColumnValue);
  }
}
