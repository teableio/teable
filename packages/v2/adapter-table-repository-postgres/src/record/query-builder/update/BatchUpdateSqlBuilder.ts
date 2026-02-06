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
    // columns: [__id, user_cols..., __last_modified_time, __last_modified_by]
    const columns: string[] = ['__id'];
    const columnFields: Array<{ name: string; field: Field | null }> = [];

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

      columns.push(columnName);

      // Get field info for type casting via visitor
      const fieldResult = getFieldByColumnName(table, columnName);
      const field = fieldResult.isOk() ? fieldResult.value : null;
      columnFields.push({ name: columnName, field });
    }

    // Add system columns at the end
    columns.push('__last_modified_time');
    columns.push('__last_modified_by');

    // Build value maps for quick lookup
    const columnValueMaps = new Map<string, Map<string, unknown>>();
    for (const [columnName, entries] of columnUpdateData) {
      const valueMap = new Map(entries.map((e) => [e.recordId, e.value]));
      columnValueMaps.set(columnName, valueMap);
    }

    // Build VALUES rows
    const valueRows: string[] = [];
    for (const recordId of recordIds) {
      const rowValues: string[] = [];

      // Add __id
      rowValues.push(escapeAndQuoteSqlValue(recordId));

      // Add user field values using FieldSqlLiteralVisitor
      for (const { name, field } of columnFields) {
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

    // Build SET clause
    const setClauses: string[] = [];

    // Add user field SET clauses (values already have type casts in VALUES)
    for (const { name } of columnFields) {
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
    // Escape schema-qualified table name properly
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
