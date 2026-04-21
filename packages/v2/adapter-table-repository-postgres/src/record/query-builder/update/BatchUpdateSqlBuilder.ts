import type { DomainError, Field, Table } from '@teable/v2-core';
import { FieldType, domainError, ok } from '@teable/v2-core';
import { CompiledQuery, type CompiledQuery as KyselyCompiledQuery, type Kysely } from 'kysely';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldSqlLiteralVisitor } from '../../visitors/FieldSqlLiteralVisitor';
import type { DynamicDB } from '../ITableRecordQueryBuilder';

type CompilableSqlExpression = {
  compile(db: Kysely<DynamicDB>): KyselyCompiledQuery;
};

/**
 * Parameters for building batch UPDATE SQL.
 */
export interface BuildBatchUpdateSqlParams {
  tableName: string;
  columnUpdateData: Map<string, Array<{ recordId: string; value: unknown }>>;
  systemColumns: {
    lastModifiedTime: string;
    lastModifiedBy: string;
    versionIncrement: boolean;
  };
  table: Table;
  db: Kysely<DynamicDB>;
}

export interface BatchUpdateReturnedOldField {
  fieldId: string;
  alias: string;
}

export function collectBatchUpdateReturnedOldFields(
  table: Table,
  columnUpdateData: ReadonlyMap<string, ReadonlyArray<{ recordId: string; value: unknown }>>
): BatchUpdateReturnedOldField[] {
  const fields: BatchUpdateReturnedOldField[] = [];
  const seenFieldIds = new Set<string>();
  for (const [columnName] of columnUpdateData) {
    if (isSystemColumn(columnName)) {
      continue;
    }

    const fieldResult = getFieldByColumnName(table, columnName);
    if (fieldResult.isErr() || isTrackedLastModifiedField(fieldResult.value)) {
      continue;
    }

    const fieldId = fieldResult.value.id().toString();
    if (seenFieldIds.has(fieldId)) {
      continue;
    }
    seenFieldIds.add(fieldId);
    fields.push({
      fieldId,
      alias: `old_${fields.length}`,
    });
  }
  return fields;
}

/**
 * Build batch UPDATE SQL using UPDATE...FROM (VALUES ...) pattern.
 *
 * Generates SQL like:
 * ```sql
 * UPDATE table AS t
 * SET
 *   col1 = v.col1,
 *   col2 = v.col2,
 *   __last_modified_time = v.__last_modified_time,
 *   __last_modified_by = v.__last_modified_by,
 *   __version = t.__version + 1
 * FROM (VALUES
 *   ('rec1', 'val1', '{"a":1}'::jsonb, '2024-01-01'::timestamptz, 'user1'),
 *   ('rec2', 'val2', '{"b":2}'::jsonb, '2024-01-01'::timestamptz, 'user1')
 * ) AS v(__id, col1, col2, __last_modified_time, __last_modified_by)
 * WHERE t.__id = v.__id
 * ```
 *
 * This approach uses VALUES instead of unnest(ARRAY[...]) because:
 * - More direct and natural for row-based updates
 * - Potentially better query optimizer handling
 * - More compact SQL with fewer parameters
 * - Easier to read and debug
 *
 * @param params - Build parameters including table, columns, and system data
 * @returns Compiled query ready for execution
 */
export function buildBatchUpdateSql(
  params: BuildBatchUpdateSqlParams
): Result<CompiledQuery, DomainError> {
  const { tableName, columnUpdateData, systemColumns, table, db } = params;

  // eslint-disable-next-line require-yield
  return safeTry<CompiledQuery, DomainError>(function* () {
    // Early return for empty batch
    if (columnUpdateData.size === 0) {
      return err(
        domainError.validation({
          message: 'No columns to update in batch',
          code: 'validation.batch_update.empty_columns',
        })
      );
    }

    // Collect all unique record IDs from ALL columns (not just first column)
    // This fixes the sparse update issue where different records update different columns
    const recordIdSet = new Set<string>();
    for (const [, entries] of columnUpdateData) {
      for (const entry of entries) {
        recordIdSet.add(entry.recordId);
      }
    }
    const recordIds = Array.from(recordIdSet);

    if (recordIds.length === 0) {
      return err(
        domainError.validation({
          message: 'No records to update in batch',
          code: 'validation.batch_update.empty_records',
        })
      );
    }

    // Build column list and field mappings
    const allColumnFields: Array<{ name: string; field: Field | null }> = [];

    // Add user field columns
    for (const [columnName] of columnUpdateData) {
      // Skip system columns (will add them at the end)
      if (isSystemColumn(columnName)) {
        continue;
      }

      // Get field info for type casting via visitor
      const fieldResult = getFieldByColumnName(table, columnName);
      const field = fieldResult.isOk() ? fieldResult.value : null;
      allColumnFields.push({ name: columnName, field });
    }

    // Build value maps for quick lookup
    const columnValueMaps = new Map<string, Map<string, unknown>>();
    for (const [columnName, entries] of columnUpdateData) {
      const valueMap = new Map(entries.map((e) => [e.recordId, e.value]));
      columnValueMaps.set(columnName, valueMap);
    }

    // Separate constant-NULL columns from varying columns.
    // A column is constant-NULL only when every record in the batch explicitly
    // provides that column with a nullish value. Missing values must preserve
    // the current stored cell instead of being coerced into clears.
    const constantNullColumnFields: Array<{ name: string; field: Field | null }> = [];
    const varyingColumnFields: Array<{ name: string; field: Field | null }> = [];

    for (const colField of allColumnFields) {
      const valueMap = columnValueMaps.get(colField.name);
      const allNull =
        !!valueMap &&
        recordIds.every((recId) => {
          if (!valueMap.has(recId)) {
            return false;
          }
          const v = valueMap.get(recId);
          return v === null || v === undefined;
        });
      if (allNull) {
        constantNullColumnFields.push(colField);
      } else {
        varyingColumnFields.push(colField);
      }
    }

    const returnedOldFields = collectReturnedOldFields(allColumnFields);
    const matchedOldValueSelects = returnedOldFields.map(
      ({ name, alias }) => `${escapeSqlIdentifier(name)} AS ${escapeSqlIdentifier(alias)}`
    );
    const returningOldValueSelects = returnedOldFields.map(
      ({ alias }) => `matched.${escapeSqlIdentifier(alias)} AS ${escapeSqlIdentifier(alias)}`
    );

    // Build SET clauses
    const setClauses: string[] = [];

    // Constant-NULL columns: SET col = NULL directly (no need for VALUES row data)
    for (const { name } of constantNullColumnFields) {
      setClauses.push(`${escapeSqlIdentifier(name)} = NULL`);
    }

    // Case 1: All user columns are constant NULL — use simple WHERE __id = ANY(...)
    if (varyingColumnFields.length === 0) {
      // System column SET clauses
      setClauses.push(
        `${escapeSqlIdentifier('__last_modified_time')} = ${escapeAndQuoteSqlValue(systemColumns.lastModifiedTime)}::timestamptz`
      );
      setClauses.push(
        `${escapeSqlIdentifier('__last_modified_by')} = ${escapeAndQuoteSqlValue(systemColumns.lastModifiedBy)}`
      );
      if (systemColumns.versionIncrement) {
        setClauses.push(
          `${escapeSqlIdentifier('__version')} = ${escapeSqlIdentifier('__version')} + 1`
        );
      }

      const escapedTableName = escapeSchemaQualifiedTableName(tableName);
      const idList = recordIds.map((id) => escapeAndQuoteSqlValue(id)).join(', ');
      const distinctWhereClause = buildConstantNullDistinctWhereClause(
        constantNullColumnFields,
        't'
      );
      const updateSql = `
WITH matched AS (
  SELECT
    ${escapeSqlIdentifier('__id')} AS ${escapeSqlIdentifier('matched_id')},
    ${escapeSqlIdentifier('__version')} AS ${escapeSqlIdentifier('old_version')}${matchedOldValueSelects.length > 0 ? `,\n    ${matchedOldValueSelects.join(',\n    ')}` : ''}
  FROM ${escapedTableName}
  WHERE ${escapeSqlIdentifier('__id')} = ANY(ARRAY[${idList}])
)
UPDATE ${escapedTableName} AS t
SET ${setClauses.join(', ')}
FROM matched
WHERE t.${escapeSqlIdentifier('__id')} = matched.${escapeSqlIdentifier('matched_id')}${distinctWhereClause}
RETURNING t.${escapeSqlIdentifier('__id')} AS ${escapeSqlIdentifier('record_id')},
  t.${escapeSqlIdentifier('__version')} AS ${escapeSqlIdentifier('new_version')},
  matched.${escapeSqlIdentifier('old_version')} AS ${escapeSqlIdentifier('old_version')}${returningOldValueSelects.length > 0 ? `,\n  ${returningOldValueSelects.join(',\n  ')}` : ''}
      `.trim();

      return ok(CompiledQuery.raw(updateSql));
    }

    // Case 2 & 3: Some or no constant-NULL columns — use VALUES for varying columns.
    // Each varying column gets a companion presence flag so omitted values keep
    // the existing stored value while explicit null still clears the column.
    const varyingColumns = varyingColumnFields.map((colField, index) => ({
      ...colField,
      presenceAlias: `__has_${index}`,
    }));

    // columns for VALUES:
    // [__id, presence/value pairs..., __last_modified_time, __last_modified_by]
    const columns: string[] = ['__id'];
    for (const { name, presenceAlias } of varyingColumns) {
      columns.push(presenceAlias);
      columns.push(name);
    }
    columns.push('__last_modified_time');
    columns.push('__last_modified_by');

    // Build VALUES rows
    const parameters: unknown[] = [];
    const valueRows: string[] = [];
    for (const recordId of recordIds) {
      const rowValues: string[] = [];

      // Add __id
      rowValues.push(escapeAndQuoteSqlValue(recordId));

      // Add varying field values using FieldSqlLiteralVisitor
      for (const { name, field, presenceAlias: _presenceAlias } of varyingColumns) {
        const valueMap = columnValueMaps.get(name);
        const hasValue = valueMap?.has(recordId) ?? false;
        const value = hasValue ? valueMap?.get(recordId) : null;

        rowValues.push(hasValue ? 'TRUE' : 'FALSE');

        if (isCompilableSqlExpression(value)) {
          rowValues.push(compileValueExpression(value, db, parameters.length, parameters));
        } else if (field) {
          // Use FieldSqlLiteralVisitor for proper type-aware SQL literal generation
          const visitor = FieldSqlLiteralVisitor.create(value);
          const literalResult = field.accept(visitor);
          if (literalResult.isOk()) {
            rowValues.push(literalResult.value);
          } else {
            // Fallback to simple text literal if visitor fails
            rowValues.push(escapeAndQuoteSqlValue(value));
          }
        } else if (name.startsWith('__row_')) {
          rowValues.push(formatRowOrderLiteral(value));
        } else {
          // No field info, use simple text literal
          rowValues.push(escapeAndQuoteSqlValue(value));
        }
      }

      // Add system columns
      rowValues.push(`${escapeAndQuoteSqlValue(systemColumns.lastModifiedTime)}::timestamptz`);
      rowValues.push(escapeAndQuoteSqlValue(systemColumns.lastModifiedBy));

      valueRows.push(`(${rowValues.join(', ')})`);
    }

    // Build column alias list with proper escaping
    const columnAliases = columns.map((col) => escapeSqlIdentifier(col)).join(', ');

    // Add varying field SET clauses (values from VALUES subquery)
    for (const { name, presenceAlias } of varyingColumns) {
      const columnAlias = escapeSqlIdentifier(name);
      const presenceIdentifier = escapeSqlIdentifier(presenceAlias);
      setClauses.push(
        `${columnAlias} = CASE WHEN v.${presenceIdentifier} THEN v.${columnAlias} ELSE t.${columnAlias} END`
      );
    }

    // Add system column SET clauses
    setClauses.push(
      `${escapeSqlIdentifier('__last_modified_time')} = v.${escapeSqlIdentifier('__last_modified_time')}`
    );
    setClauses.push(
      `${escapeSqlIdentifier('__last_modified_by')} = v.${escapeSqlIdentifier('__last_modified_by')}`
    );
    if (systemColumns.versionIncrement) {
      setClauses.push(
        `${escapeSqlIdentifier('__version')} = t.${escapeSqlIdentifier('__version')} + 1`
      );
    }

    // Build final UPDATE statement
    const escapedTableName = escapeSchemaQualifiedTableName(tableName);
    const idList = recordIds.map((id) => escapeAndQuoteSqlValue(id)).join(', ');
    const distinctWhereClause = buildValuesDistinctWhereClause(
      constantNullColumnFields,
      varyingColumns
    );
    const updateSql = `
WITH matched AS (
  SELECT
    ${escapeSqlIdentifier('__id')} AS ${escapeSqlIdentifier('matched_id')},
    ${escapeSqlIdentifier('__version')} AS ${escapeSqlIdentifier('old_version')}${matchedOldValueSelects.length > 0 ? `,\n    ${matchedOldValueSelects.join(',\n    ')}` : ''}
  FROM ${escapedTableName}
  WHERE ${escapeSqlIdentifier('__id')} = ANY(ARRAY[${idList}])
)
UPDATE ${escapedTableName} AS t
SET ${setClauses.join(', ')}
FROM matched, (VALUES
  ${valueRows.join(',\n  ')}
) AS v(${columnAliases})
WHERE t.${escapeSqlIdentifier('__id')} = v.${escapeSqlIdentifier('__id')}
  AND t.${escapeSqlIdentifier('__id')} = matched.${escapeSqlIdentifier('matched_id')}${distinctWhereClause}
RETURNING t.${escapeSqlIdentifier('__id')} AS ${escapeSqlIdentifier('record_id')},
  t.${escapeSqlIdentifier('__version')} AS ${escapeSqlIdentifier('new_version')},
  matched.${escapeSqlIdentifier('old_version')} AS ${escapeSqlIdentifier('old_version')}${returningOldValueSelects.length > 0 ? `,\n  ${returningOldValueSelects.join(',\n  ')}` : ''}
    `.trim();

    // Compile using kysely's sql tag for proper parameter handling
    return ok(CompiledQuery.raw(updateSql, parameters));
  });
}

type BatchColumnField = { name: string; field: Field | null };
type VaryingBatchColumnField = BatchColumnField & { presenceAlias: string };

function isSystemColumn(columnName: string): boolean {
  return (
    columnName === '__id' ||
    columnName === '__last_modified_time' ||
    columnName === '__last_modified_by' ||
    columnName === '__version'
  );
}

function isTrackedLastModifiedField(field: Field | null): boolean {
  if (!field) {
    return false;
  }
  const type = field.type();
  return type.equals(FieldType.lastModifiedTime()) || type.equals(FieldType.lastModifiedBy());
}

function collectReturnedOldFields(
  columns: ReadonlyArray<BatchColumnField>
): Array<{ name: string; alias: string; fieldId: string }> {
  const fields: Array<{ name: string; alias: string; fieldId: string }> = [];
  const seenFieldIds = new Set<string>();
  for (const { name, field } of columns) {
    if (!field || isTrackedLastModifiedField(field)) {
      continue;
    }
    const fieldId = field.id().toString();
    if (seenFieldIds.has(fieldId)) {
      continue;
    }
    seenFieldIds.add(fieldId);
    fields.push({ name, alias: `old_${fields.length}`, fieldId });
  }
  return fields;
}

function buildConstantNullDistinctWhereClause(
  columns: ReadonlyArray<BatchColumnField>,
  tableAlias?: string
): string {
  const columnPrefix = tableAlias ? `${tableAlias}.` : '';
  const predicates = columns
    .filter(({ field }) => !isTrackedLastModifiedField(field))
    .map(({ name }) => `${columnPrefix}${escapeSqlIdentifier(name)} IS DISTINCT FROM NULL`);

  return predicates.length > 0 ? ` AND (${predicates.join(' OR ')})` : '';
}

function buildValuesDistinctWhereClause(
  constantNullColumns: ReadonlyArray<BatchColumnField>,
  varyingColumns: ReadonlyArray<VaryingBatchColumnField>
): string {
  const predicates = [
    ...constantNullColumns
      .filter(({ field }) => !isTrackedLastModifiedField(field))
      .map(({ name }) => `t.${escapeSqlIdentifier(name)} IS DISTINCT FROM NULL`),
    ...varyingColumns
      .filter(({ field }) => !isTrackedLastModifiedField(field))
      .map(
        ({ name, presenceAlias }) =>
          `(v.${escapeSqlIdentifier(presenceAlias)} AND t.${escapeSqlIdentifier(name)} IS DISTINCT FROM v.${escapeSqlIdentifier(name)})`
      ),
  ];

  return predicates.length > 0 ? ` AND (${predicates.join(' OR ')})` : '';
}

function isCompilableSqlExpression(value: unknown): value is CompilableSqlExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    'compile' in value &&
    typeof value.compile === 'function'
  );
}

function compileValueExpression(
  expression: CompilableSqlExpression,
  db: Kysely<DynamicDB>,
  placeholderOffset: number,
  parameters: unknown[]
): string {
  const compiled = expression.compile(db);
  parameters.push(...compiled.parameters);
  return rebaseSqlPlaceholders(compiled.sql, placeholderOffset);
}

function rebaseSqlPlaceholders(sqlText: string, placeholderOffset: number): string {
  if (placeholderOffset === 0) {
    return sqlText;
  }

  return sqlText.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + placeholderOffset}`);
}

/**
 * Escape and quote a SQL value for use in VALUES clause.
 *
 * Handles NULL values and proper single quote escaping.
 *
 * @param value - Value to escape and quote
 * @returns Escaped and quoted SQL value string
 */
function escapeAndQuoteSqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  // Convert to string and escape single quotes
  const str = String(value).replace(/'/g, "''");
  return `'${str}'`;
}

function formatRowOrderLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return 'NULL';
  }
  return `${numericValue}::double precision`;
}

/**
 * Escape SQL identifier (column name, table name).
 *
 * @param identifier - Identifier to escape
 * @returns Escaped identifier
 */
function escapeSqlIdentifier(identifier: string): string {
  // Double quotes to escape them, then wrap in quotes
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Escape schema-qualified table name (schema.table).
 *
 * For schema-qualified names like "schema.table", each part must be quoted separately:
 * "schema"."table"
 *
 * @param tableName - Schema-qualified table name (schema.table)
 * @returns Properly escaped table name
 */
function escapeSchemaQualifiedTableName(tableName: string): string {
  const parts = tableName.split('.');
  if (parts.length === 2) {
    return `${escapeSqlIdentifier(parts[0])}.${escapeSqlIdentifier(parts[1])}`;
  }
  // Fallback: just escape the whole thing if it's not schema-qualified
  return escapeSqlIdentifier(tableName);
}

/**
 * Get field by column name from table.
 *
 * @param table - Table entity
 * @param columnName - Database column name
 * @returns Field if found, error otherwise
 */
function getFieldByColumnName(table: Table, columnName: string): Result<Field, DomainError> {
  return safeTry<Field, DomainError>(function* () {
    const fields = table.getFields();
    for (const field of fields) {
      const dbFieldName = yield* field.dbFieldName();
      const dbFieldNameValue = yield* dbFieldName.value();
      if (dbFieldNameValue === columnName) {
        return ok(field);
      }
    }
    return err(
      domainError.validation({
        message: `Field not found for column: ${columnName}`,
        code: 'validation.field.not_found',
        details: { columnName },
      })
    );
  });
}
