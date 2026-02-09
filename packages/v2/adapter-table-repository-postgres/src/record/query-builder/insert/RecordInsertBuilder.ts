/* eslint-disable @typescript-eslint/no-this-alias */
import type { Table, DomainError, LinkField, FieldId, TableId, RecordId } from '@teable/v2-core';
import { FieldType, ok, RecordId as RecordIdVO } from '@teable/v2-core';
import type { Kysely, CompiledQuery } from 'kysely';
import { sql } from 'kysely';

import { safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { isPersistedAsGeneratedColumn } from '../../computed/isPersistedAsGeneratedColumn';

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
  /** Foreign record IDs that need advisory locks to prevent deadlocks */
  linkedRecordLocks: LinkedRecordLockInfo[];
}

/**
 * Information about a linked foreign record that requires locking.
 */
export interface LinkedRecordLockInfo {
  /** The foreign table ID or name being referenced */
  foreignTableId: string;
  /** The foreign record ID being linked to */
  foreignRecordId: string;
}

/**
 * Describes an exclusivity constraint for insert operations.
 * Used to validate that foreign records are not already linked elsewhere.
 */
export interface InsertExclusivityConstraint {
  /** The link field that has the constraint */
  fieldId: FieldId;
  /** The foreign table being linked to */
  foreignTableId: TableId;
  /** The FK host table name (where the FK column lives) */
  fkHostTableName: string;
  /** The column name for the self key (points to source record) */
  selfKeyName: string;
  /** The column name for the foreign key (points to foreign record) */
  foreignKeyName: string;
  /** The foreign record IDs being linked */
  linkedForeignRecordIds: ReadonlyArray<string>;
  /** The source record ID making this insert */
  sourceRecordId: string;
  /** Whether this is a one-way link */
  isOneWay: boolean;
  /** Whether this uses a junction table (oneMany isOneWay) vs main table storage (oneOne) */
  usesJunctionTable: boolean;
}

/**
 * Describes extra seed records for computed update locking.
 * Used to ensure proper locking when concurrent inserts link to the same foreign record.
 */
export interface InsertExtraSeedGroup {
  /** The foreign table ID being linked to */
  tableId: TableId;
  /** The foreign record IDs that need to be locked during computed update */
  recordIds: RecordId[];
}

/**
 * Result of building INSERT data for a record (raw form for batch operations).
 */
export interface RecordInsertDataResult {
  /** Column values to insert into the main table */
  values: Record<string, unknown>;
  /** Additional SQL statements to execute after the main insert */
  additionalStatements: CompiledSqlStatement[];
  /** Foreign record IDs that need advisory locks to prevent deadlocks */
  linkedRecordLocks: LinkedRecordLockInfo[];
  /** Link exclusivity constraints for oneOne/oneMany relationships */
  exclusivityConstraints: InsertExclusivityConstraint[];
  /** Extra seed records for computed update locking (foreign records being linked to) */
  extraSeedRecords: InsertExtraSeedGroup[];
  /** User fields that need to be populated via subquery during INSERT */
  userFieldColumns: UserFieldColumn[];
}

/**
 * Describes a user field column that needs to be populated with user object.
 */
export interface UserFieldColumn {
  /** The database column name */
  dbFieldName: string;
  /** The system column to read user ID from (__created_by or __last_modified_by) */
  systemColumn: string;
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
 * Result of building link field SQLs (internal use).
 */
interface LinkFieldSqlsResult {
  statements: CompiledSqlStatement[];
  linkedRecordLocks: LinkedRecordLockInfo[];
  exclusivityConstraint?: InsertExclusivityConstraint;
  /** Foreign records being linked to, for computed update locking */
  extraSeedRecords: InsertExtraSeedGroup[];
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
      const linkedRecordLocks: LinkedRecordLockInfo[] = [];
      const exclusivityConstraints: InsertExclusivityConstraint[] = [];
      const extraSeedRecordsMap = new Map<
        string,
        { tableId: TableId; recordIds: Map<string, RecordId> }
      >();
      const userFieldColumns: UserFieldColumn[] = [];

      // Map field values to database columns
      const fields = table.getFields();

      for (const field of fields) {
        const fieldIdStr = field.id().toString();
        const rawValue = fieldValues.get(fieldIdStr) ?? null;

        const isCreatedTime = field.type().equals(FieldType.createdTime());
        const isLastModifiedTime = field.type().equals(FieldType.lastModifiedTime());
        const isCreatedBy = field.type().equals(FieldType.createdBy());
        const isLastModifiedBy = field.type().equals(FieldType.lastModifiedBy());
        const isAutoNumber = field.type().equals(FieldType.autoNumber());
        const isSystemComputedField =
          isCreatedTime || isLastModifiedTime || isCreatedBy || isLastModifiedBy || isAutoNumber;

        if (field.computed().toBoolean()) {
          if (!isSystemComputedField) {
            continue;
          }

          // CreatedBy and LastModifiedBy fields need to be populated with full user object
          // We set them directly in INSERT values using a subquery to fetch user info
          if (isCreatedBy || isLastModifiedBy) {
            const dbFieldNameResult = field.dbFieldName();
            if (dbFieldNameResult.isErr()) {
              continue;
            }
            const dbFieldNameValueResult = dbFieldNameResult.value.value();
            if (dbFieldNameValueResult.isErr()) {
              continue;
            }
            const dbFieldName = dbFieldNameValueResult.value;
            const systemColumn = isCreatedBy ? CREATED_BY_COLUMN : LAST_MODIFIED_BY_COLUMN;
            userFieldColumns.push({ dbFieldName, systemColumn });

            // Set user field value directly in INSERT using subquery
            // Use COALESCE to provide a fallback when user doesn't exist in users table
            const avatarPrefix = '/api/attachments/read/public/avatar/';
            const userSubquery = sql`COALESCE(
              (
                SELECT jsonb_build_object(
                  'id', u.id,
                  'title', u.name,
                  'email', u.email,
                  'avatarUrl', ${avatarPrefix} || u.id
                )
                FROM public.users u
                WHERE u.id = ${context.actorId}::text
              ),
              jsonb_build_object(
                'id', ${context.actorId}::text,
                'title', ${context.actorId}::text,
                'email', NULL::text,
                'avatarUrl', ${avatarPrefix}::text || ${context.actorId}::text
              )
            )`;
            values[dbFieldName] = userSubquery;
            continue;
          }

          const persistedAsGenerated = yield* isPersistedAsGeneratedColumn(field);
          if (persistedAsGenerated) {
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

          const fallbackValue =
            isCreatedTime || isLastModifiedTime
              ? context.now
              : isCreatedBy || isLastModifiedBy
                ? context.actorId
                : null;
          const resolvedValue = rawValue ?? fallbackValue;
          const dbFieldTypeResult = field.dbFieldType();
          let dbFieldTypeValue: string | null = null;
          if (dbFieldTypeResult.isOk()) {
            const dbFieldTypeValueResult = dbFieldTypeResult.value.value();
            if (dbFieldTypeValueResult.isOk()) {
              dbFieldTypeValue = dbFieldTypeValueResult.value;
            }
          }
          const isJsonField = dbFieldTypeValue
            ? dbFieldTypeValue.toLowerCase().includes('json')
            : false;
          values[dbFieldName] =
            isJsonField && resolvedValue !== null && resolvedValue !== undefined
              ? JSON.stringify(resolvedValue)
              : resolvedValue;
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
            const linkResult = yield* builder.buildLinkFieldSqls(
              linkField,
              rawValue,
              context.recordId
            );
            additionalStatements.push(...linkResult.statements);
            linkedRecordLocks.push(...linkResult.linkedRecordLocks);
            if (linkResult.exclusivityConstraint) {
              exclusivityConstraints.push(linkResult.exclusivityConstraint);
            }
            // Collect extra seed records for computed update locking
            for (const seedGroup of linkResult.extraSeedRecords) {
              const tableIdStr = seedGroup.tableId.toString();
              const entry = extraSeedRecordsMap.get(tableIdStr) ?? {
                tableId: seedGroup.tableId,
                recordIds: new Map<string, RecordId>(),
              };
              for (const recordId of seedGroup.recordIds) {
                entry.recordIds.set(recordId.toString(), recordId);
              }
              extraSeedRecordsMap.set(tableIdStr, entry);
            }
          }
        } else {
          // Fallback: just use raw value
          values[dbFieldName] = rawValue;
        }
      }

      // Convert extraSeedRecordsMap to array
      const extraSeedRecords: InsertExtraSeedGroup[] = [...extraSeedRecordsMap.values()].map(
        (entry) => ({
          tableId: entry.tableId,
          recordIds: [...entry.recordIds.values()],
        })
      );

      return ok({
        values,
        additionalStatements,
        linkedRecordLocks,
        exclusivityConstraints,
        extraSeedRecords,
        userFieldColumns,
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
      const { values, additionalStatements, linkedRecordLocks } = yield* builder.buildInsertData({
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
        linkedRecordLocks,
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
  ): Result<LinkFieldSqlsResult, DomainError> {
    const builder = this;

    return safeTry<LinkFieldSqlsResult, DomainError>(function* () {
      const statements: CompiledSqlStatement[] = [];
      const linkedRecordLocks: LinkedRecordLockInfo[] = [];
      const extraSeedRecords: InsertExtraSeedGroup[] = [];
      let exclusivityConstraint: InsertExclusivityConstraint | undefined;

      // Parse link items
      const linkItems = Array.isArray(rawValue)
        ? (rawValue as Array<{ id: string }>)
        : [rawValue as { id: string }];

      if (linkItems.length === 0) {
        return ok({ statements, linkedRecordLocks, extraSeedRecords });
      }

      const relationship = field.relationship().toString();
      const foreignTableId = field.foreignTableId().toString();

      // Determine if this relationship uses a junction table
      // oneMany with isOneWay uses junction table, oneOne doesn't (stores FK on main table)
      const usesJunctionTable =
        relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay());

      // Collect extra seed records for computed update locking
      // ALL link types need this to ensure the symmetric field on the foreign record is updated correctly
      // when concurrent inserts link to the same foreign record
      const foreignRecordIds: RecordId[] = [];
      for (const linkItem of linkItems) {
        const recordIdResult = RecordIdVO.create(linkItem.id);
        if (recordIdResult.isOk()) {
          foreignRecordIds.push(recordIdResult.value);
        }
      }
      if (foreignRecordIds.length > 0) {
        extraSeedRecords.push({
          tableId: field.foreignTableId(),
          recordIds: foreignRecordIds,
        });
      }

      // Collect exclusivity constraint for oneOne and oneMany relationships
      if (field.requiresExclusiveForeignRecord()) {
        const fkHostTableName = field.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const fkHostTableNameStr = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* field.selfKeyNameString();
        const foreignKeyName = yield* field.foreignKeyNameString();

        exclusivityConstraint = {
          fieldId: field.id(),
          foreignTableId: field.foreignTableId(),
          fkHostTableName: fkHostTableNameStr,
          selfKeyName,
          foreignKeyName,
          linkedForeignRecordIds: linkItems.map((item) => item.id),
          sourceRecordId: recordId,
          isOneWay: field.isOneWay(),
          usesJunctionTable,
        };
      }

      if (usesJunctionTable) {
        // Junction table: insert rows for each linked record
        const fkHostTableName = field.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const junctionTableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* field.selfKeyNameString();
        const foreignKeyName = yield* field.foreignKeyNameString();
        const orderColumnName = field.hasOrderColumn() ? yield* field.orderColumnName() : null;

        for (let i = 0; i < linkItems.length; i++) {
          const linkItem = linkItems[i];
          const order = i + 1;

          // Collect lock info for the foreign record to prevent deadlocks
          linkedRecordLocks.push({
            foreignTableId,
            foreignRecordId: linkItem.id,
          });

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
            ...(orderColumnName ? { [orderColumnName]: order } : {}),
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
          // Collect lock info for the foreign record to prevent deadlocks
          linkedRecordLocks.push({
            foreignTableId,
            foreignRecordId: linkItem.id,
          });

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

      return ok({ statements, linkedRecordLocks, exclusivityConstraint, extraSeedRecords });
    });
  }

  /**
   * Build an UPDATE statement to populate user fields after INSERT.
   * This uses a subquery to fetch user info from the users table.
   *
   * @param tableName - The fully qualified table name (schema.table)
   * @param recordId - The record ID to update
   * @param userFieldColumns - List of user field columns to populate
   * @returns A compiled UPDATE statement, or undefined if no user fields
   */
  static buildUserFieldUpdateStatement(
    db: Kysely<DynamicDB>,
    tableName: string,
    recordId: string,
    userFieldColumns: ReadonlyArray<UserFieldColumn>
  ): CompiledSqlStatement | undefined {
    if (userFieldColumns.length === 0) {
      return undefined;
    }

    // Build SET clause with subqueries for each user field
    // Use COALESCE to provide a fallback when user doesn't exist in users table
    const setValues: Record<string, unknown> = {};
    const avatarPrefix = '/api/attachments/read/public/avatar/';

    for (const { dbFieldName, systemColumn } of userFieldColumns) {
      // Use raw SQL to build the subquery expression for user object
      const userSubquery = sql`COALESCE(
        (
          SELECT jsonb_build_object(
            'id', u.id,
            'title', u.name,
            'email', u.email,
            'avatarUrl', ${avatarPrefix} || u.id
          )
          FROM public.users u
          WHERE u.id = ${sql.ref(systemColumn)}
        ),
        jsonb_build_object(
          'id', ${sql.ref(systemColumn)},
          'title', ${sql.ref(systemColumn)},
          'email', NULL::text,
          'avatarUrl', ${avatarPrefix} || ${sql.ref(systemColumn)}
        )
      )`;
      setValues[dbFieldName] = userSubquery;
    }

    const updateQuery = db
      .updateTable(tableName)
      .set(setValues)
      .where(RECORD_ID_COLUMN, '=', recordId);

    return {
      description: `Populate user fields for record ${recordId}`,
      compiled: updateQuery.compile(),
    };
  }
}
