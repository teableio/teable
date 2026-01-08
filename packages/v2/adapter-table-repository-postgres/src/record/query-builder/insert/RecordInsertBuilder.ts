/* eslint-disable @typescript-eslint/no-this-alias */
import type { Table, DomainError, LinkField } from '@teable/v2-core';
import { FieldType, ok } from '@teable/v2-core';
import type { Kysely, CompiledQuery } from 'kysely';
import { safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldInsertValueVisitor, type FieldInsertResult } from '../../visitors';
import type { DynamicDB } from '../ITableRecordQueryBuilder';

// System columns
const RECORD_ID_COLUMN = '__id';
const CREATED_TIME_COLUMN = '__created_time';
const CREATED_BY_COLUMN = '__created_by';
const LAST_MODIFIED_TIME_COLUMN = '__last_modified_time';
const LAST_MODIFIED_BY_COLUMN = '__last_modified_by';
const VERSION_COLUMN = '__version';

/**
 * A compiled SQL statement with description.
 */
export interface CompiledSqlStatement {
  /** Human-readable description of what this SQL does */
  description: string;
  /** The compiled SQL query */
  compiled: CompiledQuery;
}

/**
 * Result of building INSERT SQLs for a record (compiled form).
 */
export interface RecordInsertSqlResult {
  /** The main INSERT statement */
  mainInsert: CompiledSqlStatement;
  /** Additional SQL statements (junction table inserts, FK updates for link fields) */
  additionalStatements: CompiledSqlStatement[];
}

/**
 * Result of building INSERT data for a record (raw form for batch operations).
 */
export interface RecordInsertDataResult {
  /** Column values to insert into the main table */
  values: Record<string, unknown>;
  /** Additional SQL statements to execute after the main insert */
  additionalStatements: CompiledSqlStatement[];
}

/**
 * Context for building insert data.
 */
export interface RecordInsertBuilderContext {
  recordId: string;
  actorId: string;
  now: string;
}

/**
 * Builds INSERT SQL statements for a record.
 *
 * This builder generates the same SQL that PostgresTableRecordRepository would execute,
 * but returns compiled SQL instead of executing it directly. This allows the SQL to be
 * used for EXPLAIN analysis, or the raw values can be used for batch inserts.
 *
 * @example
 * ```typescript
 * const builder = new RecordInsertBuilder(db);
 *
 * // For EXPLAIN (compiled SQL)
 * const result = builder.build({
 *   table,
 *   tableName: 'my_table',
 *   fieldValues: new Map([['fld_xxx', 'value']]),
 *   context: { recordId: 'rec_xxx', actorId: 'usr_xxx', now: new Date().toISOString() },
 * });
 *
 * // For batch insert (raw values)
 * const dataResult = builder.buildInsertData({
 *   table,
 *   fieldValues: new Map([['fld_xxx', 'value']]),
 *   context: { recordId: 'rec_xxx', actorId: 'usr_xxx', now: new Date().toISOString() },
 * });
 * ```
 */
export class RecordInsertBuilder {
  constructor(private readonly db: Kysely<DynamicDB>) {}

  /**
   * Build INSERT data for a record (raw values for batch operations).
   * Use this when you need to batch multiple inserts together.
   */
  buildInsertData(params: {
    table: Table;
    fieldValues: ReadonlyMap<string, unknown>;
    context: RecordInsertBuilderContext;
  }): Result<RecordInsertDataResult, DomainError> {
    const { table, fieldValues, context } = params;
    const builder = this;

    return safeTry<RecordInsertDataResult, DomainError>(function* () {
      // System columns
      const values: Record<string, unknown> = {
        [RECORD_ID_COLUMN]: context.recordId,
        [CREATED_TIME_COLUMN]: context.now,
        [CREATED_BY_COLUMN]: context.actorId,
        [LAST_MODIFIED_TIME_COLUMN]: context.now,
        [LAST_MODIFIED_BY_COLUMN]: context.actorId,
        [VERSION_COLUMN]: 1,
      };

      const additionalStatements: CompiledSqlStatement[] = [];

      // Map field values to database columns
      const fields = table.getFields();

      for (const field of fields) {
        // Skip computed fields
        if (field.computed().toBoolean()) {
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

        const fieldIdStr = field.id().toString();
        const rawValue = fieldValues.get(fieldIdStr) ?? null;

        // Use visitor to get column values
        const insertVisitor = FieldInsertValueVisitor.create(rawValue, {
          recordId: context.recordId,
          dbFieldName,
        });
        const insertResult: Result<FieldInsertResult, DomainError> = field.accept(insertVisitor);

        if (insertResult.isOk()) {
          const { columnValues } = insertResult.value;
          Object.assign(values, columnValues);

          // For link fields, generate additional SQLs for junction tables / FK updates
          if (
            field.type().equals(FieldType.link()) &&
            rawValue !== null &&
            rawValue !== undefined
          ) {
            const linkField = field as LinkField;
            const linkSqls = yield* builder.buildLinkFieldSqls(
              linkField,
              rawValue,
              context.recordId
            );
            additionalStatements.push(...linkSqls);
          }
        } else {
          // Fallback: just use raw value
          values[dbFieldName] = rawValue;
        }
      }

      return ok({
        values,
        additionalStatements,
      });
    });
  }

  /**
   * Build INSERT SQL statements for a record (compiled form).
   * Use this for EXPLAIN analysis or when you need the actual SQL strings.
   */
  build(params: {
    table: Table;
    tableName: string;
    fieldValues: ReadonlyMap<string, unknown>;
    context: RecordInsertBuilderContext;
  }): Result<RecordInsertSqlResult, DomainError> {
    const { table, tableName, fieldValues, context } = params;
    const builder = this;

    return safeTry<RecordInsertSqlResult, DomainError>(function* () {
      const { values, additionalStatements } = yield* builder.buildInsertData({
        table,
        fieldValues,
        context,
      });

      // Build main INSERT SQL
      const insertQuery = builder.db.insertInto(tableName).values(values);
      const compiled = insertQuery.compile();

      return ok({
        mainInsert: {
          description: `Insert new record into ${tableName}`,
          compiled,
        },
        additionalStatements,
      });
    });
  }

  /**
   * Execute compiled SQL statements.
   * This is a convenience method for executing the additional statements.
   */
  static async executeStatements(
    db: Kysely<DynamicDB>,
    statements: ReadonlyArray<CompiledSqlStatement>
  ): Promise<void> {
    for (const stmt of statements) {
      await db.executeQuery(stmt.compiled);
    }
  }

  /**
   * Build SQLs for link field operations (junction table inserts, FK updates).
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
      const linkItems = Array.isArray(rawValue)
        ? (rawValue as Array<{ id: string }>)
        : [rawValue as { id: string }];

      if (linkItems.length === 0) {
        return ok(statements);
      }

      const relationship = field.relationship().toString();

      if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
        // Junction table: insert rows for each linked record
        const fkHostTableName = field.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const junctionTableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* field.selfKeyNameString();
        const foreignKeyName = yield* field.foreignKeyNameString();
        const orderColumnName = yield* field.orderColumnName();

        for (let i = 0; i < linkItems.length; i++) {
          const linkItem = linkItems[i];
          const order = i + 1;

          // DELETE existing link
          const deleteQuery = builder.db
            .deleteFrom(junctionTableName)
            .where(selfKeyName, '=', recordId)
            .where(foreignKeyName, '=', linkItem.id);
          const deleteCompiled = deleteQuery.compile();

          statements.push({
            description: `Delete existing junction link (${selfKeyName}=${recordId}, ${foreignKeyName}=${linkItem.id})`,
            compiled: deleteCompiled,
          });

          // INSERT new link
          const insertValues: Record<string, unknown> = {
            [selfKeyName]: recordId,
            [foreignKeyName]: linkItem.id,
            [orderColumnName]: order,
          };
          const insertQuery = builder.db.insertInto(junctionTableName).values(insertValues);
          const insertCompiled = insertQuery.compile();

          statements.push({
            description: `Insert junction link to ${linkItem.id} (order: ${order})`,
            compiled: insertCompiled,
          });
        }
      } else if (relationship === 'oneMany') {
        // oneMany (two-way): FK is on the foreign table
        const fkHostTableName = field.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const foreignTableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* field.selfKeyNameString();

        for (const linkItem of linkItems) {
          const updateQuery = builder.db
            .updateTable(foreignTableName)
            .set({ [selfKeyName]: recordId })
            .where('__id', '=', linkItem.id);
          const updateCompiled = updateQuery.compile();

          statements.push({
            description: `Update foreign record ${linkItem.id} to link back`,
            compiled: updateCompiled,
          });
        }
      }
      // manyOne/oneOne: FK is set in the main INSERT values, no additional SQL needed

      return ok(statements);
    });
  }
}
