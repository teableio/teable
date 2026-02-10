import type { DomainError, Field, Table } from '@teable/v2-core';
import { domainError, ok } from '@teable/v2-core';
import type { CompiledQuery, Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldSqlLiteralVisitor } from '../../visitors/FieldSqlLiteralVisitor';
import type { DynamicDB } from '../ITableRecordQueryBuilder';

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
      if (
        columnName === '__id' ||
        columnName === '__last_modified_time' ||
        columnName === '__last_modified_by' ||
        columnName === '__version'
      ) {
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

    // Separate constant-NULL columns from varying columns
    // A column is constant-NULL if all records have null/undefined for it
    const constantNullColumns: string[] = [];
    const varyingColumnFields: Array<{ name: string; field: Field | null }> = [];

    for (const colField of allColumnFields) {
      const valueMap = columnValueMaps.get(colField.name);
      const allNull =
        !valueMap ||
        recordIds.every((recId) => {
          const v = valueMap.get(recId);
          return v === null || v === undefined;
        });
      if (allNull) {
        constantNullColumns.push(colField.name);
      } else {
        varyingColumnFields.push(colField);
      }
    }

    // Build SET clauses
    const setClauses: string[] = [];

    // Constant-NULL columns: SET col = NULL directly (no need for VALUES row data)
    for (const colName of constantNullColumns) {
      setClauses.push(`${escapeSqlIdentifier(colName)} = NULL`);
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
      const updateSql = `
UPDATE ${escapedTableName}
SET ${setClauses.join(', ')}
WHERE "__id" = ANY(ARRAY[${idList}])
      `.trim();

      const query = sql.raw(updateSql);
      return ok(query.compile(db));
    }

    // Case 2 & 3: Some or no constant-NULL columns — use VALUES for varying columns
    // columns for VALUES: [__id, varying_cols..., __last_modified_time, __last_modified_by]
    const columns: string[] = ['__id'];
    for (const { name } of varyingColumnFields) {
      columns.push(name);
    }
    columns.push('__last_modified_time');
    columns.push('__last_modified_by');

    // Build VALUES rows
    const valueRows: string[] = [];
    for (const recordId of recordIds) {
      const rowValues: string[] = [];

      // Add __id
      rowValues.push(escapeAndQuoteSqlValue(recordId));

      // Add varying field values using FieldSqlLiteralVisitor
      for (const { name, field } of varyingColumnFields) {
        const valueMap = columnValueMaps.get(name);
        const value = valueMap?.get(recordId) ?? null;

        if (field) {
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
    for (const { name } of varyingColumnFields) {
      const columnAlias = escapeSqlIdentifier(name);
      setClauses.push(`${columnAlias} = v.${columnAlias}`);
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
    const updateSql = `
UPDATE ${escapedTableName} AS t
SET ${setClauses.join(', ')}
FROM (VALUES
  ${valueRows.join(',\n  ')}
) AS v(${columnAliases})
WHERE t.__id = v.__id
    `.trim();

    // Compile using kysely's sql tag for proper parameter handling
    const query = sql.raw(updateSql);

    return ok(query.compile(db));
  });
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
