import { domainError, Field, FieldType, FieldValueTypeVisitor } from '@teable/v2-core';
import type { FieldId, TableId, DomainError, Table } from '@teable/v2-core';
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
import { COMPUTED_TABLE_ALIAS } from '../query-builder/computed';

export type UpdateRecordFilter = (params: {
  db: Kysely<DynamicDB>;
  query: UpdateQueryBuilder<DynamicDB, string, string, UpdateResult>;
  tableId: TableId;
  tableAlias: string;
  selectAlias: string;
}) => UpdateQueryBuilder<DynamicDB, string, string, UpdateResult>;

/**
 * Configuration for dirty record filtering.
 * When provided, the UPDATE will only affect records in the dirty table.
 */
export type DirtyFilterConfig = {
  /** The table ID to filter by in the dirty table */
  tableId: TableId;
  /** The name of the dirty table (default: 'tmp_computed_dirty') */
  dirtyTableName?: string;
  /** Column name for table ID in dirty table (default: 'table_id') */
  tableIdColumn?: string;
  /** Column name for record ID in dirty table (default: 'record_id') */
  recordIdColumn?: string;
};

export type UpdateFromSelectParams = {
  table: Table;
  fieldIds: ReadonlyArray<FieldId>;
  selectQuery: QB;
  tableAlias?: string;
  selectAlias?: string;
  recordFilter?: UpdateRecordFilter;
  /**
   * When provided, applies a dirty filter to only update records
   * that exist in the dirty table. This ensures computed updates
   * only affect records that have been marked as dirty.
   */
  dirtyFilter?: DirtyFilterConfig;
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

        // Apply dirty filter to the SELECT query if provided
        // Use INNER JOIN instead of IN subquery for better query planning.
        // PostgreSQL's planner often chooses to scan the entire main table first
        // when using IN subquery, even when the dirty table is very small.
        // INNER JOIN allows the planner to use the small dirty table to drive
        // indexed lookups on the main table.
        let finalSelectQuery = params.selectQuery;
        if (params.dirtyFilter) {
          const {
            tableId,
            dirtyTableName = 'tmp_computed_dirty',
            tableIdColumn = 'table_id',
            recordIdColumn = 'record_id',
          } = params.dirtyFilter;

          finalSelectQuery = params.selectQuery.innerJoin(`${dirtyTableName} as __dirty`, (join) =>
            join
              .onRef(`${COMPUTED_TABLE_ALIAS}.__id`, '=', `__dirty.${recordIdColumn}`)
              .on(`__dirty.${tableIdColumn}`, '=', tableId.toString())
          ) as QB;
        }

        let query = this.db
          .updateTable(`${tableName} as ${tableAlias}`)
          .from(finalSelectQuery.as(selectAlias))
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
  lookupDbFieldType?: string;
};

const jsonSpecResult = Field.specs().isJson().build();

const fieldIsJson = (field: Field): boolean => {
  if (jsonSpecResult.isErr()) return false;
  return jsonSpecResult.value.isSatisfiedBy(field);
};

const resolveDbFieldType = (
  field: Field,
  cellValueType: string,
  isMultipleCellValue: boolean
): string => {
  if (isMultipleCellValue) return 'JSON';
  if (fieldIsJson(field)) return 'JSON';
  switch (cellValueType) {
    case 'number':
      return 'REAL';
    case 'dateTime':
      return 'DATETIME';
    case 'boolean':
      return 'BOOLEAN';
    case 'string':
      return 'TEXT';
    default:
      return 'TEXT';
  }
};

const normalizeDbFieldType = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case 'JSON':
      return 'jsonb';
    case 'REAL':
      return 'double precision';
    case 'DATETIME':
      return 'timestamptz';
    case 'BOOLEAN':
      return 'boolean';
    case 'TEXT':
      return 'text';
    default:
      return normalized.toLowerCase();
  }
};

const buildLookupScalarCast = (expression: ReturnType<typeof sql>, columnType: string) => {
  switch (columnType) {
    case 'double precision':
    case 'numeric':
    case 'decimal':
    case 'integer':
    case 'bigint':
    case 'smallint':
      return sql`NULLIF(${expression}, '')::${sql.raw(columnType)}`;
    case 'boolean':
      return sql`${expression}::boolean`;
    case 'timestamptz':
    case 'timestamp with time zone':
      return sql`${expression}::timestamptz`;
    case 'timestamp':
    case 'timestamp without time zone':
      return sql`${expression}::timestamp`;
    case 'date':
      return sql`${expression}::date`;
    default:
      return expression;
  }
};

const buildLookupAssignment = (
  eb: ExpressionBuilder<DynamicDB, string>,
  selectAlias: string,
  column: string,
  lookupDbFieldType: string
) => {
  const normalizedType = normalizeDbFieldType(lookupDbFieldType);
  const ref = eb.ref(`${selectAlias}.${column}`);
  if (normalizedType === 'jsonb') {
    return sql`to_jsonb(${ref})`;
  }
  const scalarText = sql`(${ref} ->> 0)`;
  return buildLookupScalarCast(scalarText, normalizedType);
};

const buildSetValues = (
  table: Table,
  fieldIds: ReadonlyArray<FieldId>,
  selectAlias: string
): Result<SetValueBuilder, DomainError> => {
  return safeTry<SetValueBuilder, DomainError>(function* () {
    const mappings: FieldMapping[] = [];
    const valueTypeVisitor = new FieldValueTypeVisitor();

    for (const fieldId of fieldIds) {
      const field = yield* table.getField((candidate) => candidate.id().equals(fieldId));
      const dbFieldName = yield* field.dbFieldName();
      const columnName = yield* dbFieldName.value();
      const isLookup =
        field.type().equals(FieldType.lookup()) ||
        field.type().equals(FieldType.conditionalLookup());
      const lookupDbFieldType = isLookup
        ? yield* field
            .dbFieldType()
            .andThen((dbFieldType) => dbFieldType.value())
            .orElse(() =>
              field
                .accept(valueTypeVisitor)
                .map((valueType) =>
                  resolveDbFieldType(
                    field,
                    valueType.cellValueType.toString(),
                    valueType.isMultipleCellValue.toBoolean()
                  )
                )
            )
        : undefined;
      mappings.push({ column: columnName, fieldId, isLookup, lookupDbFieldType });
    }

    return ok((eb) => {
      const values: Record<string, unknown> = {};
      for (const mapping of mappings) {
        if (mapping.isLookup && mapping.lookupDbFieldType) {
          values[mapping.column] = buildLookupAssignment(
            eb,
            selectAlias,
            mapping.column,
            mapping.lookupDbFieldType
          );
        } else {
          values[mapping.column] = eb.ref(`${selectAlias}.${mapping.column}`);
        }
      }
      return values;
    });
  });
};
