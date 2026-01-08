import { domainError, FieldType } from '@teable/v2-core';
import type { FieldId, TableId, type DomainError, type Table } from '@teable/v2-core';
import type {
  CompiledQuery,
  ExpressionBuilder,
  Kysely,
  UpdateQueryBuilder,
  UpdateResult,
} from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DynamicDB, QB } from '../query-builder';

export type UpdateRecordFilter = (params: {
  db: Kysely<DynamicDB>;
  query: UpdateQueryBuilder<DynamicDB, string, string, UpdateResult>;
  tableId: TableId;
  tableAlias: string;
  selectAlias: string;
}) => UpdateQueryBuilder<DynamicDB, string, string, UpdateResult>;

export type UpdateFromSelectParams = {
  table: Table;
  fieldIds: ReadonlyArray<FieldId>;
  selectQuery: QB;
  tableAlias?: string;
  selectAlias?: string;
  recordFilter?: UpdateRecordFilter;
};

/**
 * Build UPDATE...FROM statements using a computed SELECT subquery.
 *
 * Example
 * ```typescript
 * const compiled = await builder.build({
 *   table,
 *   fieldIds: [formulaFieldId],
 *   selectQuery: computedSelect,
 * });
 * await db.executeQuery(compiled);
 * ```
 */
export class UpdateFromSelectBuilder {
  constructor(private readonly db: Kysely<DynamicDB>) {}

  build(params: UpdateFromSelectParams): Result<CompiledQuery, DomainError> {
    const tableAlias = params.tableAlias ?? 'u';
    const selectAlias = params.selectAlias ?? 'c';
    const fieldIds = params.fieldIds;

    if (fieldIds.length === 0) {
      return err(
        domainError.validation({ message: 'UpdateFromSelect requires at least one field' })
      );
    }

    return params.table
      .dbTableName()
      .andThen((dbTableName) => dbTableName.value())
      .andThen((tableName) => {
        const setValuesResult = buildSetValues(params.table, fieldIds, selectAlias);
        if (setValuesResult.isErr()) return err(setValuesResult.error);

        let query = this.db
          .updateTable(`${tableName} as ${tableAlias}`)
          .from(params.selectQuery.as(selectAlias))
          .set((eb) => setValuesResult.value(eb))
          .whereRef(`${tableAlias}.__id`, '=', `${selectAlias}.__id`);

        if (params.recordFilter) {
          query = params.recordFilter({
            db: this.db,
            query,
            tableId: params.table.id(),
            tableAlias,
            selectAlias,
          });
        }

        return ok(query.compile());
      });
  }
}

type SetValueBuilder = (eb: ExpressionBuilder<DynamicDB, string>) => Record<string, unknown>;

type FieldMapping = {
  column: string;
  fieldId: FieldId;
  isLookup: boolean;
};

const buildSetValues = (
  table: Table,
  fieldIds: ReadonlyArray<FieldId>,
  selectAlias: string
): Result<SetValueBuilder, DomainError> => {
  return safeTry<SetValueBuilder, DomainError>(function* () {
    const mappings: FieldMapping[] = [];

    for (const fieldId of fieldIds) {
      const field = yield* table.getField((candidate) => candidate.id().equals(fieldId));
      const dbFieldName = yield* field.dbFieldName();
      const columnName = yield* dbFieldName.value();
      const isLookup = field.type().equals(FieldType.lookup());
      mappings.push({ column: columnName, fieldId, isLookup });
    }

    return ok((eb) => {
      const values: Record<string, unknown> = {};
      for (const mapping of mappings) {
        if (mapping.isLookup) {
          // Lookup fields need to_jsonb() conversion because:
          // - ARRAY_AGG returns PostgreSQL array type (e.g. timestamp with time zone[])
          // - Lookup fields are stored as JSONB in the database
          // - Some array types (like timestamp[]) cannot be directly cast to JSONB
          values[mapping.column] = sql`to_jsonb(${eb.ref(`${selectAlias}.${mapping.column}`)})`;
        } else {
          values[mapping.column] = eb.ref(`${selectAlias}.${mapping.column}`);
        }
      }
      return values;
    });
  });
};
