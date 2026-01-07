/* eslint-disable @typescript-eslint/no-this-alias */
import type { Table, DomainError, LinkField } from '@teable/v2-core';
import { FieldType, ok } from '@teable/v2-core';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldInsertValueVisitor, type FieldInsertResult } from '../../visitors';
import type { CompiledSqlStatement } from '../insert';
import type { DynamicDB } from '../ITableRecordQueryBuilder';

// System columns
const RECORD_ID_COLUMN = '__id';
const LAST_MODIFIED_TIME_COLUMN = '__last_modified_time';
const LAST_MODIFIED_BY_COLUMN = '__last_modified_by';
const VERSION_COLUMN = '__version';

/**
 * Result of building UPDATE SQLs for a record (compiled form).
 */
export interface RecordUpdateSqlResult {
  /** The main UPDATE statement */
  mainUpdate: CompiledSqlStatement;
  /** Additional SQL statements (junction table updates, FK updates for link fields) */
  additionalStatements: CompiledSqlStatement[];
}

/**
 * Context for building update data.
 */
export interface RecordUpdateBuilderContext {
  actorId: string;
  now: string;
}

/**
 * Builds UPDATE SQL statements for a record.
 *
 * This builder generates the same SQL that PostgresTableRecordRepository would execute,
 * but returns compiled SQL instead of executing it directly. This allows the SQL to be
 * used for EXPLAIN analysis.
 *
 * @example
 * ```typescript
 * const builder = new RecordUpdateBuilder(db);
 * const result = builder.build({
 *   table,
 *   tableName: 'my_table',
 *   fieldValues: new Map([['fld_xxx', 'value']]),
 *   recordId: 'rec_xxx',
 *   context: { actorId: 'usr_xxx', now: new Date().toISOString() },
 * });
 * ```
 */
export class RecordUpdateBuilder {
  constructor(private readonly db: Kysely<DynamicDB>) {}

  /**
   * Build UPDATE SQL statements for a record (compiled form).
   * Use this for EXPLAIN analysis or when you need the actual SQL strings.
   */
  build(params: {
    table: Table;
    tableName: string;
    tableDisplayName?: string;
    fieldValues: ReadonlyMap<string, unknown>;
    recordId: string;
    context: RecordUpdateBuilderContext;
  }): Result<RecordUpdateSqlResult, DomainError> {
    const { table, tableName, tableDisplayName, fieldValues, recordId, context } = params;
    const builder = this;

    return safeTry<RecordUpdateSqlResult, DomainError>(function* () {
      // System columns for update
      const values: Record<string, unknown> = {
        [LAST_MODIFIED_TIME_COLUMN]: context.now,
        [LAST_MODIFIED_BY_COLUMN]: context.actorId,
        [VERSION_COLUMN]: sql`${sql.ref(VERSION_COLUMN)} + 1`,
      };

      const additionalStatements: CompiledSqlStatement[] = [];
      const fields = table.getFields();

      for (const field of fields) {
        const fieldIdStr = field.id().toString();

        // Only process fields that are in the fieldValues map
        if (!fieldValues.has(fieldIdStr)) {
          continue;
        }

        const rawValue = fieldValues.get(fieldIdStr) ?? null;

        // Skip computed fields
        if (field.computed().toBoolean()) {
          continue;
        }

        // Handle link fields separately
        if (field.type().equals(FieldType.link())) {
          const linkField = field as LinkField;
          const linkSqls = yield* builder.buildLinkFieldSqls(linkField, rawValue, recordId);
          additionalStatements.push(...linkSqls);
          continue;
        }

        const dbFieldNameResult = field.dbFieldName();
        if (dbFieldNameResult.isErr()) {
          continue;
        }
        const dbFieldNameValueResult = dbFieldNameResult.value.value();
        if (dbFieldNameValueResult.isErr()) {
          continue;
        }
        const dbFieldName = dbFieldNameValueResult.value;

        // Use visitor to get column values
        const insertVisitor = FieldInsertValueVisitor.create(rawValue, {
          recordId,
          dbFieldName,
        });
        const insertResult: Result<FieldInsertResult, DomainError> = field.accept(insertVisitor);

        if (insertResult.isOk()) {
          const { columnValues } = insertResult.value;
          Object.assign(values, columnValues);
        } else {
          // Fallback: just use raw value
          values[dbFieldName] = rawValue;
        }
      }

      // Build main UPDATE SQL
      const updateQuery = builder.db
        .updateTable(tableName)
        .set(values)
        .where(RECORD_ID_COLUMN, '=', recordId);
      const compiled = updateQuery.compile();

      return ok({
        mainUpdate: {
          description: `Update record in ${tableDisplayName ?? tableName}`,
          compiled,
        },
        additionalStatements,
      });
    });
  }

  /**
   * Build SQLs for link field operations (junction table updates, FK updates).
   */
  private buildLinkFieldSqls(
    field: LinkField,
    rawValue: unknown,
    recordId: string
  ): Result<CompiledSqlStatement[], DomainError> {
    const builder = this;

    return safeTry<CompiledSqlStatement[], DomainError>(function* () {
      const statements: CompiledSqlStatement[] = [];

      // Parse link items
      const linkItems: Array<{ id: string }> = [];
      if (rawValue !== null && rawValue !== undefined) {
        const items = Array.isArray(rawValue)
          ? (rawValue as Array<{ id: string }>)
          : [rawValue as { id: string }];
        linkItems.push(...items.filter((item) => item && typeof item === 'object' && 'id' in item));
      }

      const relationship = field.relationship().toString();
      const hasOrderColumn = field.hasOrderColumn();
      const orderColumnName = hasOrderColumn ? yield* field.orderColumnName() : null;

      if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
        const fkHostTableName = field.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const junctionTableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* field.selfKeyNameString();
        const foreignKeyName = yield* field.foreignKeyNameString();

        // Delete all existing links for this record
        const deleteQuery = builder.db
          .deleteFrom(junctionTableName)
          .where(selfKeyName, '=', recordId);
        const deleteCompiled = deleteQuery.compile();

        statements.push({
          description: `Delete existing junction links for ${selfKeyName}=${recordId}`,
          compiled: deleteCompiled,
        });

        // Insert new links
        for (let i = 0; i < linkItems.length; i++) {
          const linkItem = linkItems[i];
          const insertValues: Record<string, unknown> = {
            [selfKeyName]: recordId,
            [foreignKeyName]: linkItem.id,
          };
          if (orderColumnName) {
            insertValues[orderColumnName] = i + 1;
          }
          const insertQuery = builder.db.insertInto(junctionTableName).values(insertValues);
          const insertCompiled = insertQuery.compile();

          statements.push({
            description: `Insert junction link to ${linkItem.id} (order: ${i + 1})`,
            compiled: insertCompiled,
          });
        }
      } else if (relationship === 'manyOne' || relationship === 'oneOne') {
        // For manyOne/oneOne, the FK column is on the main table
        // This is handled in the main UPDATE values, so no additional statements needed
      } else if (relationship === 'oneMany') {
        // oneMany (two-way): FK is on the foreign table
        const fkHostTableName = field.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const foreignTableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* field.selfKeyNameString();

        // Clear previous links
        const clearValues: Record<string, unknown> = { [selfKeyName]: null };
        if (orderColumnName) {
          clearValues[orderColumnName] = null;
        }
        const clearQuery = builder.db
          .updateTable(foreignTableName)
          .set(clearValues)
          .where(selfKeyName, '=', recordId);
        const clearCompiled = clearQuery.compile();

        statements.push({
          description: `Clear existing links in ${foreignTableName}`,
          compiled: clearCompiled,
        });

        // Set new links
        for (let i = 0; i < linkItems.length; i++) {
          const linkItem = linkItems[i];
          const updateValues: Record<string, unknown> = { [selfKeyName]: recordId };
          if (orderColumnName) {
            updateValues[orderColumnName] = i + 1;
          }
          const updateQuery = builder.db
            .updateTable(foreignTableName)
            .set(updateValues)
            .where('__id', '=', linkItem.id);
          const updateCompiled = updateQuery.compile();

          statements.push({
            description: `Update foreign record ${linkItem.id} to link back (order: ${i + 1})`,
            compiled: updateCompiled,
          });
        }
      }

      return ok(statements);
    });
  }
}
