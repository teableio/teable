import { domainError, type DomainError, type FieldId, type Table } from '@teable/v2-core';
import { sql, type AliasedRawBuilder, type Kysely, type SelectQueryBuilder } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok, safeTry } from 'neverthrow';

import { StoredFieldSelectVisitor } from './StoredFieldSelectVisitor';

const T = 't'; // main table alias

type DynamicDB = Record<string, Record<string, unknown>>;
type QB = SelectQueryBuilder<DynamicDB, string, Record<string, unknown>>;

/**
 * Query builder that selects all stored column values directly.
 * No LATERAL joins, no formula computation - just raw column selection.
 * Used for fast reads when pre-computed values are acceptable.
 */
export class StoredTableRecordQueryBuilder {
  private table: Table | null = null;
  private projection: FieldId[] | null = null;
  private limitValue: number | null = null;
  private offsetValue: number | null = null;

  constructor(private readonly db: Kysely<DynamicDB>) {}

  from(table: Table): this {
    this.table = table;
    return this;
  }

  select(projection: FieldId[]): this {
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

        const query = this.db
          .selectFrom(`${tableName} as ${T}`)
          .select(() => [idColumn, ...selectColumns])
          .$if(this.limitValue !== null, (qb) => qb.limit(this.limitValue!))
          .$if(this.offsetValue !== null, (qb) => qb.offset(this.offsetValue!));

        return ok(query);
      }.bind(this)
    );
  }

  private buildSelectColumns(
    table: Table,
    projection: FieldId[] | null
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
}
