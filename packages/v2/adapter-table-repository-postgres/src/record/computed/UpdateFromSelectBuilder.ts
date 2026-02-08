import { domainError, Field, FieldType, FieldValueTypeVisitor } from '@teable/v2-core';
import type {
  DomainError,
  FieldId,
  Table,
  TableId,
  ConditionalLookupField,
  FieldValueType,
  LookupField,
} from '@teable/v2-core';
import type {
  CompiledQuery,
  Expression,
  ExpressionBuilder,
  Kysely,
  SqlBool,
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
 * Result of UPDATE with RETURNING clause.
 */
export type UpdateWithReturningResult = {
  /** The compiled query */
  compiled: CompiledQuery;
  /** Mapping from column name to field ID */
  columnToFieldId: Map<string, string>;
};

/**
 * A row returned from UPDATE...RETURNING.
 */
export type UpdatedRecordRow = {
  __id: string;
  /** Version of the record BEFORE this computed update (version - 1 after UPDATE) */
  __old_version: number;
  [column: string]: unknown;
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
        const fieldMappingsResult = buildFieldMappings(params.table, fieldIds);
        if (fieldMappingsResult.isErr()) return err(fieldMappingsResult.error);
        const setValuesResult = buildSetValues(fieldMappingsResult.value, selectAlias, tableAlias);
        if (setValuesResult.isErr()) return err(setValuesResult.error);
        const distinctFilter = buildDistinctFilter(
          fieldMappingsResult.value,
          selectAlias,
          tableAlias
        );

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

        if (distinctFilter) {
          query = query.where((eb) => distinctFilter(eb));
        }

        return ok(query.compile());
      });
  }

  /**
   * Build UPDATE...FROM statement with RETURNING clause to get updated record IDs and new values.
   * This is used for event generation after computed field updates.
   */
  buildWithReturning(
    params: UpdateFromSelectParams
  ): Result<UpdateWithReturningResult, DomainError> {
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
        const fieldMappingsResult = buildFieldMappings(params.table, fieldIds);
        if (fieldMappingsResult.isErr()) return err(fieldMappingsResult.error);
        const setValuesResult = buildSetValues(fieldMappingsResult.value, selectAlias, tableAlias);
        if (setValuesResult.isErr()) return err(setValuesResult.error);
        const distinctFilter = buildDistinctFilter(
          fieldMappingsResult.value,
          selectAlias,
          tableAlias
        );

        // Build column to fieldId mapping for RETURNING
        const columnMapping = buildColumnMapping(fieldMappingsResult.value);

        // Apply dirty filter to the SELECT query if provided
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

        if (distinctFilter) {
          query = query.where((eb) => distinctFilter(eb));
        }

        // Add RETURNING clause for record ID, old version, and all updated columns
        // Use double quotes to preserve case-sensitivity in PostgreSQL
        // Return __version - 1 as __old_version (the version BEFORE this computed update)
        const returningColumns = [
          `"${tableAlias}"."__id"`,
          `"${tableAlias}"."__version" - 1 as "__old_version"`,
        ];
        for (const [column] of columnMapping) {
          returningColumns.push(`"${tableAlias}"."${column}"`);
        }

        // Use raw SQL for RETURNING since Kysely's typing doesn't support it well for updates
        const compiled = query.compile();
        const returningClause = ` RETURNING ${returningColumns.join(', ')}`;
        const sqlWithReturning = compiled.sql + returningClause;

        return ok({
          compiled: {
            ...compiled,
            sql: sqlWithReturning,
          },
          columnToFieldId: columnMapping,
        });
      });
  }
}

type SetValueBuilder = (eb: ExpressionBuilder<DynamicDB, string>) => Record<string, unknown>;

type FieldMapping = {
  column: string;
  fieldId: FieldId;
  isLookup: boolean;
  dbFieldType: string;
};

const jsonSpecResult = Field.specs().isJson().build();

const fieldIsJson = (field: Field): boolean => {
  if (jsonSpecResult.isErr()) return false;
  return jsonSpecResult.value.isSatisfiedBy(field);
};

const shouldSkipLookupAutoNumberUpdate = (field: Field): boolean => {
  if (
    !field.type().equals(FieldType.lookup()) &&
    !field.type().equals(FieldType.conditionalLookup())
  ) {
    return false;
  }
  const lookupField = field as LookupField | ConditionalLookupField;
  const innerTypeResult = lookupField.innerFieldType();
  if (innerTypeResult.isErr()) return false;
  return innerTypeResult.value.equals(FieldType.autoNumber());
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

const resolveLookupScalarDbFieldType = (
  field: Field,
  valueType: FieldValueType
): Result<string, DomainError> => {
  const base = resolveDbFieldType(field, valueType.cellValueType.toString(), false);
  if (field.type().equals(FieldType.lookup())) {
    return (field as LookupField)
      .innerFieldType()
      .map((innerType) => {
        // V1 compatibility: AutoNumber lookups should use INTEGER, not REAL/double precision
        if (innerType.equals(FieldType.autoNumber())) {
          return 'INTEGER';
        }
        return base;
      })
      .orElse(() => {
        // Fallback: If inner field isn't resolved (pending validation), infer from dbFieldType
        // This handles V1 fields where dbFieldType might already be set correctly (e.g., INTEGER)
        return field
          .dbFieldType()
          .andThen((dbFieldType) => dbFieldType.value())
          .orElse(() => ok(base));
      });
  }
  if (field.type().equals(FieldType.conditionalLookup())) {
    return (field as ConditionalLookupField)
      .innerFieldType()
      .map((innerType) => {
        if (innerType.equals(FieldType.autoNumber())) {
          return 'INTEGER';
        }
        return base;
      })
      .orElse(() => {
        return field
          .dbFieldType()
          .andThen((dbFieldType) => dbFieldType.value())
          .orElse(() => ok(base));
      });
  }
  return ok(base);
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

const buildFieldMappings = (
  table: Table,
  fieldIds: ReadonlyArray<FieldId>
): Result<ReadonlyArray<FieldMapping>, DomainError> => {
  return safeTry<ReadonlyArray<FieldMapping>, DomainError>(function* () {
    const mappings: FieldMapping[] = [];
    const valueTypeVisitor = new FieldValueTypeVisitor();

    for (const fieldId of fieldIds) {
      const field = yield* table.getField((candidate) => candidate.id().equals(fieldId));
      // Skip fields with errors - they should not be updated
      if (field.hasError().isError()) {
        continue;
      }
      if (shouldSkipLookupAutoNumberUpdate(field)) {
        continue;
      }
      const dbFieldName = yield* field.dbFieldName();
      const columnName = yield* dbFieldName.value();
      // Determine if this is a lookup field
      // V1 compatibility: V1 stores lookup fields with isLookup=true metadata and a specific type
      // (e.g., type='autoNumber', isLookup=true). When loaded by V2, these become LookupField instances
      // with the original field type as the inner field.
      const isLookup =
        field.type().equals(FieldType.lookup()) ||
        field.type().equals(FieldType.conditionalLookup());

      const valueType = yield* field.accept(valueTypeVisitor);
      const derivedDbFieldType = resolveDbFieldType(
        field,
        valueType.cellValueType.toString(),
        valueType.isMultipleCellValue.toBoolean()
      );
      const persistedDbFieldTypeResult = field
        .dbFieldType()
        .andThen((dbFieldType) => dbFieldType.value());
      const persistedDbFieldType = persistedDbFieldTypeResult.isOk()
        ? persistedDbFieldTypeResult.value
        : undefined;
      let dbFieldType = persistedDbFieldType ?? derivedDbFieldType;

      // Created/LastModified time fields are stored as TEXT columns even though their
      // semantic value type is DATETIME. Use TEXT here to align DISTINCT comparisons
      // with the actual column type and avoid type-mismatch errors.
      if (
        field.type().equals(FieldType.createdTime()) ||
        field.type().equals(FieldType.lastModifiedTime())
      ) {
        dbFieldType = 'TEXT';
      }

      // For single-value lookups, resolve the scalar dbFieldType for proper SQL generation.
      // The SELECT query (built by ComputedTableRecordQueryBuilder) returns JSONB arrays for all
      // lookup fields. For single-value lookups stored in scalar columns, we need to extract the
      // first array element and cast it to the target type.
      //
      // V1 compatibility: V1 stores AutoNumber lookups with dbFieldType='INTEGER'. V2 needs to
      // handle these correctly by ensuring buildLookupAssignment receives the right dbFieldType.
      if (isLookup && !valueType.isMultipleCellValue.toBoolean()) {
        // Always resolve to the scalar type for single-value lookups. This avoids stale JSON
        // dbFieldType metadata from v1 causing jsonb assignments into scalar columns.
        dbFieldType = yield* resolveLookupScalarDbFieldType(field, valueType);
      }

      mappings.push({ column: columnName, fieldId, isLookup, dbFieldType });
    }

    return ok(mappings);
  });
};

const buildAssignmentValue = (
  eb: ExpressionBuilder<DynamicDB, string>,
  selectAlias: string,
  mapping: FieldMapping
) => {
  if (mapping.isLookup) {
    return buildLookupAssignment(eb, selectAlias, mapping.column, mapping.dbFieldType);
  }

  const normalizedType = normalizeDbFieldType(mapping.dbFieldType);
  const ref = eb.ref(`${selectAlias}.${mapping.column}`);
  if (normalizedType === 'jsonb') {
    return sql`to_jsonb(${ref})`;
  }

  return ref;
};

const buildComparisonValue = (
  eb: ExpressionBuilder<DynamicDB, string>,
  selectAlias: string,
  mapping: FieldMapping
) => {
  const assigned = buildAssignmentValue(eb, selectAlias, mapping);
  const normalizedType = normalizeDbFieldType(mapping.dbFieldType);
  if (normalizedType === 'jsonb') {
    return assigned;
  }
  return sql`${assigned}::${sql.raw(normalizedType)}`;
};

const buildSetValues = (
  mappings: ReadonlyArray<FieldMapping>,
  selectAlias: string,
  tableAlias: string
): Result<SetValueBuilder, DomainError> => {
  return ok((eb) => {
    const values: Record<string, unknown> = {};
    // Increment __version for computed updates (like V1 does)
    values['__version'] = sql`"${sql.raw(tableAlias)}"."__version" + 1`;

    for (const mapping of mappings) {
      values[mapping.column] = buildAssignmentValue(eb, selectAlias, mapping);
    }
    return values;
  });
};

const buildDistinctFilter = (
  mappings: ReadonlyArray<FieldMapping>,
  selectAlias: string,
  tableAlias: string
): ((eb: ExpressionBuilder<DynamicDB, string>) => Expression<SqlBool>) | undefined => {
  if (mappings.length === 0) return undefined;
  return (eb) => {
    const conditions = mappings.map((mapping) => {
      const assigned = buildComparisonValue(eb, selectAlias, mapping);
      return sql<SqlBool>`"${sql.raw(tableAlias)}"."${sql.raw(
        mapping.column
      )}" IS DISTINCT FROM ${assigned}`;
    });
    return sql<SqlBool>`(${sql.join(conditions, sql` OR `)})`;
  };
};

/**
 * Build a mapping from column name to field ID for RETURNING clause processing.
 */
const buildColumnMapping = (mappings: ReadonlyArray<FieldMapping>): Map<string, string> => {
  const mapping = new Map<string, string>();
  for (const entry of mappings) {
    mapping.set(entry.column, entry.fieldId.toString());
  }
  return mapping;
};
