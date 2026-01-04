import * as core from '@teable/v2-core';
import {
  domainError,
  type ILogger,
  isDomainError,
  v2CoreTokens,
  type DomainError,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type Transaction } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ComputedFieldUpdater, ComputedUpdatePlanner, IUpdateStrategy } from '../computed';
import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB } from '../query-builder';
import { FieldInsertValueVisitor, type FieldInsertResult, type QueryExecutor } from '../visitors';

// System columns
const RECORD_ID_COLUMN = '__id';
const CREATED_TIME_COLUMN = '__created_time';
const CREATED_BY_COLUMN = '__created_by';
const LAST_MODIFIED_TIME_COLUMN = '__last_modified_time';
const LAST_MODIFIED_BY_COLUMN = '__last_modified_by';
const VERSION_COLUMN = '__version';
// Note: __auto_number is a serial primary key - do NOT insert it manually

interface RecordInsertData {
  values: Record<string, unknown>;
  queryExecutors: QueryExecutor<DynamicDB>[];
}

type ExtraSeedRecordGroup = {
  tableId: core.TableId;
  recordIds: core.RecordId[];
};

/**
 * PostgreSQL implementation of TableRecordRepository.
 *
 * Handles insert, update, and delete operations for table records.
 */
@injectable()
export class PostgresTableRecordRepository implements core.ITableRecordRepository {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly computedUpdatePlanner: ComputedUpdatePlanner,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldUpdater)
    private readonly computedFieldUpdater: ComputedFieldUpdater,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateStrategy)
    private readonly computedUpdateStrategy: IUpdateStrategy
  ) {}

  /**
   * Build insert data for a single record.
   * This is shared between insert and insertMany.
   */
  private buildRecordInsertData(
    table: core.Table,
    record: core.TableRecord,
    context: core.IExecutionContext,
    now: string
  ): RecordInsertData {
    const recordId = record.id().toString();
    const actorId = context.actorId.toString();

    // Build the insert values with system columns
    const values: Record<string, unknown> = {
      [RECORD_ID_COLUMN]: recordId,
      [CREATED_TIME_COLUMN]: now,
      [CREATED_BY_COLUMN]: actorId,
      [LAST_MODIFIED_TIME_COLUMN]: now,
      [LAST_MODIFIED_BY_COLUMN]: actorId,
      [VERSION_COLUMN]: 1,
    };

    // Collect query executors (junction inserts, FK updates, etc.)
    const queryExecutors: QueryExecutor<DynamicDB>[] = [];

    // Map field values to database columns using FieldInsertValueVisitor
    const fields = table.getFields();
    const recordFields = record.fields();

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

      const cellValue = recordFields.get(field.id());
      const rawValue = cellValue?.toValue() ?? null;

      // Use visitor to get column values and query executors
      const insertVisitor = FieldInsertValueVisitor.create(rawValue, {
        recordId,
        dbFieldName,
      });
      const insertResult: Result<FieldInsertResult, DomainError> = field.accept(insertVisitor);

      if (insertResult.isOk()) {
        const { columnValues, queryExecutors: executors } = insertResult.value;
        // Merge column values into main insert
        Object.assign(values, columnValues);
        // Collect query executors
        queryExecutors.push(...executors);
      } else {
        // Fallback: just use raw value
        values[dbFieldName] = rawValue;
      }
    }

    return { values, queryExecutors };
  }

  async insert(
    context: core.IExecutionContext,
    table: core.Table,
    record: core.TableRecord
  ): Promise<Result<void, DomainError>> {
    return safeTry<void, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const now = new Date().toISOString();
        const { values, queryExecutors } = this.buildRecordInsertData(table, record, context, now);

        this.logger.debug(`insert:table=${tableName}`, { values });

        // Use transaction-aware database connection
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

        try {
          // Execute the main insert
          await db.insertInto(tableName).values(values).execute();

          // Execute additional queries from visitors (junction inserts, FK updates, etc.)
          for (const executor of queryExecutors) {
            await executor(db);
          }

          const computedResult = await this.runComputedUpdate(context, table, record, 'insert');
          if (computedResult.isErr()) {
            return err(computedResult.error);
          }
        } catch (error) {
          return err(
            domainError.infrastructure({
              message: `Failed to insert record: ${describeError(error)}`,
              code: 'infrastructure.database.insert_failed',
              details: { tableName, error: describeError(error) },
            })
          );
        }

        return ok(undefined);
      }.bind(this)
    );
  }

  /**
   * Default batch size for insertMany to stay under PostgreSQL's ~65535 parameter limit.
   * With ~10 columns per record (user fields + system columns), 500 records = ~5000 params.
   */
  private static readonly INSERT_BATCH_SIZE = 500;

  async insertMany(
    context: core.IExecutionContext,
    table: core.Table,
    records: ReadonlyArray<core.TableRecord>
  ): Promise<Result<void, DomainError>> {
    return safeTry<void, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        if (records.length === 0) {
          return ok(undefined);
        }

        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const now = new Date().toISOString();

        // Build insert data for all records
        const allValues: Record<string, unknown>[] = [];
        const allQueryExecutors: QueryExecutor<DynamicDB>[] = [];

        for (const record of records) {
          const { values, queryExecutors } = this.buildRecordInsertData(
            table,
            record,
            context,
            now
          );
          allValues.push(values);
          allQueryExecutors.push(...queryExecutors);
        }

        this.logger.debug(`insertMany:table=${tableName}`, { count: records.length });

        // Use transaction-aware database connection
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

        try {
          // Execute batch inserts to stay under PG parameter limit
          const batchSize = PostgresTableRecordRepository.INSERT_BATCH_SIZE;
          for (let i = 0; i < allValues.length; i += batchSize) {
            const batch = allValues.slice(i, i + batchSize);
            await db.insertInto(tableName).values(batch).execute();
          }

          // Execute additional queries from visitors (junction inserts, FK updates, etc.)
          for (const executor of allQueryExecutors) {
            await executor(db);
          }

          const computedResult = await this.runComputedUpdateMany(
            context,
            table,
            records,
            'insert'
          );
          if (computedResult.isErr()) {
            return err(computedResult.error);
          }
        } catch (error) {
          return err(
            domainError.infrastructure({
              message: `Failed to insert records: ${describeError(error)}`,
              code: 'infrastructure.database.insert_many_failed',
              details: { tableName, count: records.length, error: describeError(error) },
            })
          );
        }

        return ok(undefined);
      }.bind(this)
    );
  }

  async insertManyStream(
    context: core.IExecutionContext,
    table: core.Table,
    batches:
      | Iterable<ReadonlyArray<core.TableRecord>>
      | AsyncIterable<ReadonlyArray<core.TableRecord>>,
    options?: core.InsertManyStreamOptions
  ): Promise<Result<core.InsertManyStreamResult, DomainError>> {
    let totalInserted = 0;
    let batchIndex = 0;

    // Handle both sync and async iterables
    const processBatch = async (batch: ReadonlyArray<core.TableRecord>) => {
      const result = await this.insertMany(context, table, batch);
      if (result.isErr()) {
        return result;
      }

      totalInserted += batch.length;
      options?.onBatchInserted?.({
        batchIndex,
        insertedCount: batch.length,
        totalInserted,
      });
      batchIndex++;
      return ok(undefined);
    };

    if (Symbol.asyncIterator in batches) {
      for await (const batch of batches as AsyncIterable<ReadonlyArray<core.TableRecord>>) {
        const result = await processBatch(batch);
        if (result.isErr()) {
          return err(result.error);
        }
      }
    } else {
      for (const batch of batches as Iterable<ReadonlyArray<core.TableRecord>>) {
        const result = await processBatch(batch);
        if (result.isErr()) {
          return err(result.error);
        }
      }
    }

    return ok({ totalInserted });
  }

  async update(
    context: core.IExecutionContext,
    table: core.Table,
    record: core.TableRecord
  ): Promise<Result<void, DomainError>> {
    return safeTry<void, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();
        const recordId = record.id().toString();
        const actorId = context.actorId.toString();
        const now = new Date().toISOString();

        // Use transaction-aware database connection
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
        const extraSeedMap = new Map<
          string,
          { tableId: core.TableId; recordIds: Map<string, core.RecordId> }
        >();

        const values: Record<string, unknown> = {
          [LAST_MODIFIED_TIME_COLUMN]: now,
          [LAST_MODIFIED_BY_COLUMN]: actorId,
          [VERSION_COLUMN]: sql`${sql.ref(VERSION_COLUMN)} + 1`,
        };
        const queryExecutors: QueryExecutor<DynamicDB>[] = [];

        // Apply updates only for fields provided in the record.
        for (const entry of record.fields().entries()) {
          const field = yield* table.getField((candidate) => candidate.id().equals(entry.fieldId));

          const rawValue = entry.value.toValue();

          if (field.type().equals(core.FieldType.link())) {
            const linkField = field as core.LinkField;
            const existingLinks = yield* await loadExistingLinkRecordIds(
              db,
              tableName,
              recordId,
              linkField
            );
            const mergeResult = mergeExtraSeedRecords(
              extraSeedMap,
              linkField.foreignTableId(),
              existingLinks
            );
            if (mergeResult.isErr()) return err(mergeResult.error);
            const linkOps = yield* buildLinkUpdateOperations(linkField, rawValue, recordId);
            Object.assign(values, linkOps.columnValues);
            queryExecutors.push(...linkOps.queryExecutors);
            continue;
          }

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

          const updateVisitor = FieldInsertValueVisitor.create(rawValue, {
            recordId,
            dbFieldName,
          });
          const updateResult: Result<FieldInsertResult, DomainError> = field.accept(updateVisitor);

          if (updateResult.isOk()) {
            const { columnValues, queryExecutors: executors } = updateResult.value;
            Object.assign(values, columnValues);
            queryExecutors.push(...executors);
          } else {
            values[dbFieldName] = rawValue ?? null;
          }
        }

        try {
          await db
            .updateTable(tableName)
            .set(values)
            .where(RECORD_ID_COLUMN, '=', recordId)
            .execute();

          for (const executor of queryExecutors) {
            await executor(db);
          }

          const computedResult = await this.runComputedUpdate(
            context,
            table,
            record,
            'update',
            finalizeExtraSeedRecords(extraSeedMap)
          );
          if (computedResult.isErr()) {
            return err(computedResult.error);
          }
        } catch (error) {
          return err(
            domainError.infrastructure({
              message: `Failed to update record: ${describeError(error)}`,
              code: 'infrastructure.database.update_failed',
              details: { tableName, recordId, error: describeError(error) },
            })
          );
        }

        return ok(undefined);
      }.bind(this)
    );
  }

  async delete(
    context: core.IExecutionContext,
    table: core.Table,
    recordId: core.RecordId
  ): Promise<Result<void, DomainError>> {
    return safeTry<void, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();
        const recordIdValue = recordId.toString();

        // Use transaction-aware database connection
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
        const extraSeedMap = new Map<
          string,
          { tableId: core.TableId; recordIds: Map<string, core.RecordId> }
        >();

        const linkFields = table
          .getFields()
          .filter((field): field is core.LinkField => field.type().equals(core.FieldType.link()));

        for (const linkField of linkFields) {
          const existingLinks = yield* await loadExistingLinkRecordIds(
            db,
            tableName,
            recordIdValue,
            linkField
          );
          const mergeResult = mergeExtraSeedRecords(
            extraSeedMap,
            linkField.foreignTableId(),
            existingLinks
          );
          if (mergeResult.isErr()) return err(mergeResult.error);
        }

        try {
          await db.deleteFrom(tableName).where(RECORD_ID_COLUMN, '=', recordIdValue).execute();

          const computedResult = await this.runComputedDeleteUpdate(
            context,
            table,
            recordId,
            finalizeExtraSeedRecords(extraSeedMap)
          );
          if (computedResult.isErr()) {
            return err(computedResult.error);
          }
        } catch (error) {
          return err(
            domainError.infrastructure({
              message: `Failed to delete record: ${describeError(error)}`,
              code: 'infrastructure.database.delete_failed',
              details: { tableName, recordId: recordId.toString(), error: describeError(error) },
            })
          );
        }

        return ok(undefined);
      }.bind(this)
    );
  }

  private async runComputedUpdate(
    context: core.IExecutionContext,
    table: core.Table,
    record: core.TableRecord,
    changeType: 'insert' | 'update' | 'delete',
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = []
  ): Promise<Result<void, DomainError>> {
    const changedFieldIds = record
      .fields()
      .entries()
      .map((entry) => entry.fieldId);
    const planResult = await this.computedUpdatePlanner.plan({
      table,
      changedFieldIds,
      changedRecordIds: [record.id()],
      changeType,
    });
    if (planResult.isErr()) return err(planResult.error);
    const plan = {
      ...planResult.value,
      extraSeedRecords,
    };
    return this.computedUpdateStrategy.execute(this.computedFieldUpdater, plan, context);
  }

  private async runComputedUpdateMany(
    context: core.IExecutionContext,
    table: core.Table,
    records: ReadonlyArray<core.TableRecord>,
    changeType: 'insert' | 'update' | 'delete',
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = []
  ): Promise<Result<void, DomainError>> {
    if (records.length === 0) return ok(undefined);
    const fieldIds = new Map<string, core.FieldId>();
    const recordIds: core.RecordId[] = [];

    for (const record of records) {
      recordIds.push(record.id());
      for (const entry of record.fields().entries()) {
        fieldIds.set(entry.fieldId.toString(), entry.fieldId);
      }
    }

    const planResult = await this.computedUpdatePlanner.plan({
      table,
      changedFieldIds: [...fieldIds.values()],
      changedRecordIds: recordIds,
      changeType,
    });
    if (planResult.isErr()) return err(planResult.error);
    const plan = {
      ...planResult.value,
      extraSeedRecords,
    };
    return this.computedUpdateStrategy.execute(this.computedFieldUpdater, plan, context);
  }

  private async runComputedDeleteUpdate(
    context: core.IExecutionContext,
    table: core.Table,
    recordId: core.RecordId,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = []
  ): Promise<Result<void, DomainError>> {
    const allFieldIds = table.getFields().map((field) => field.id());
    const planResult = await this.computedUpdatePlanner.plan({
      table,
      changedFieldIds: allFieldIds,
      changedRecordIds: [recordId],
      changeType: 'delete',
    });
    if (planResult.isErr()) return err(planResult.error);
    const plan = {
      ...planResult.value,
      extraSeedRecords,
    };
    return this.computedUpdateStrategy.execute(this.computedFieldUpdater, plan, context);
  }
}

type LinkItem = { id: string };

const normalizeLinkItems = (rawValue: unknown): Result<ReadonlyArray<LinkItem>, DomainError> => {
  if (rawValue === null || rawValue === undefined) return ok([]);
  const items = Array.isArray(rawValue) ? rawValue : [rawValue];
  const normalized: LinkItem[] = [];

  for (const item of items) {
    if (item && typeof item === 'object' && 'id' in item) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === 'string') {
        normalized.push({ id });
        continue;
      }
    }
    return err(domainError.validation({ message: 'Invalid link item' }));
  }

  return ok(normalized);
};

const resolveFkHostTableName = (field: core.LinkField): Result<string, DomainError> => {
  return field
    .fkHostTableName()
    .split({ defaultSchema: 'public' })
    .map((split) => (split.schema ? `${split.schema}.${split.tableName}` : split.tableName));
};

const buildLinkUpdateOperations = (
  field: core.LinkField,
  rawValue: unknown,
  recordId: string
): Result<FieldInsertResult<DynamicDB>, DomainError> => {
  return safeTry<FieldInsertResult<DynamicDB>, DomainError>(function* () {
    const columnValues: Record<string, unknown> = {};
    const queryExecutors: QueryExecutor<DynamicDB>[] = [];
    const linkItems = yield* normalizeLinkItems(rawValue);

    const relationship = field.relationship().toString();
    const hasOrderColumn = field.hasOrderColumn();
    const orderColumnName = hasOrderColumn ? yield* field.orderColumnName() : null;

    if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
      const tableName = yield* resolveFkHostTableName(field);
      const selfKeyName = yield* field.selfKeyNameString();
      const foreignKeyName = yield* field.foreignKeyNameString();

      // Replace all existing links for this record to avoid stale relationships.
      queryExecutors.push(async (db) => {
        await db.deleteFrom(tableName).where(selfKeyName, '=', recordId).execute();

        for (let i = 0; i < linkItems.length; i++) {
          const linkItem = linkItems[i];
          const insertValues: Record<string, unknown> = {
            [selfKeyName]: recordId,
            [foreignKeyName]: linkItem.id,
          };
          if (orderColumnName) {
            insertValues[orderColumnName] = i + 1;
          }
          await db.insertInto(tableName).values(insertValues).execute();
        }
      });

      return ok({ columnValues, queryExecutors });
    }

    if (relationship === 'manyOne' || relationship === 'oneOne') {
      const foreignKeyName = yield* field.foreignKeyNameString();
      columnValues[foreignKeyName] = linkItems[0]?.id ?? null;
      return ok({ columnValues, queryExecutors });
    }

    if (relationship === 'oneMany') {
      const tableName = yield* resolveFkHostTableName(field);
      const selfKeyName = yield* field.selfKeyNameString();

      // Clear previous links, then apply the new ordered list.
      queryExecutors.push(async (db) => {
        const clearValues: Record<string, unknown> = { [selfKeyName]: null };
        if (orderColumnName) {
          clearValues[orderColumnName] = null;
        }
        await db
          .updateTable(tableName)
          .set(clearValues)
          .where(selfKeyName, '=', recordId)
          .execute();

        for (let i = 0; i < linkItems.length; i++) {
          const linkItem = linkItems[i];
          const updateValues: Record<string, unknown> = { [selfKeyName]: recordId };
          if (orderColumnName) {
            updateValues[orderColumnName] = i + 1;
          }
          await db
            .updateTable(tableName)
            .set(updateValues)
            .where('__id', '=', linkItem.id)
            .execute();
        }
      });

      return ok({ columnValues, queryExecutors });
    }

    return err(domainError.validation({ message: 'Unsupported link relationship' }));
  });
};

const loadExistingLinkRecordIds = async (
  db: Kysely<DynamicDB>,
  tableName: string,
  recordId: string,
  field: core.LinkField
): Promise<Result<string[], DomainError>> => {
  const relationship = field.relationship().toString();

  const readRows = async (targetTable: string, columnName: string, whereColumn: string) => {
    const rows = await db
      .selectFrom(targetTable)
      .select(sql.ref(columnName).as('record_id'))
      .where(whereColumn, '=', recordId)
      .execute();

    return rows
      .map((row) => row.record_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
  };

  try {
    if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
      const junctionTableResult = resolveFkHostTableName(field);
      if (junctionTableResult.isErr()) return err(junctionTableResult.error);
      const selfKeyResult = field.selfKeyNameString();
      if (selfKeyResult.isErr()) return err(selfKeyResult.error);
      const foreignKeyResult = field.foreignKeyNameString();
      if (foreignKeyResult.isErr()) return err(foreignKeyResult.error);

      const rows = await readRows(
        junctionTableResult.value,
        foreignKeyResult.value,
        selfKeyResult.value
      );
      return ok(rows);
    }

    if (relationship === 'manyOne' || relationship === 'oneOne') {
      const foreignKeyResult = field.foreignKeyNameString();
      if (foreignKeyResult.isErr()) return err(foreignKeyResult.error);

      const rows = await db
        .selectFrom(tableName)
        .select(sql.ref(foreignKeyResult.value).as('record_id'))
        .where(RECORD_ID_COLUMN, '=', recordId)
        .executeTakeFirst();

      const value = rows?.record_id;
      if (!value || typeof value !== 'string') return ok([]);
      return ok([value]);
    }

    if (relationship === 'oneMany') {
      const foreignTableResult = resolveFkHostTableName(field);
      if (foreignTableResult.isErr()) return err(foreignTableResult.error);
      const selfKeyResult = field.selfKeyNameString();
      if (selfKeyResult.isErr()) return err(selfKeyResult.error);

      const rows = await readRows(foreignTableResult.value, RECORD_ID_COLUMN, selfKeyResult.value);
      return ok(rows);
    }

    return ok([]);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to load existing link records: ${describeError(error)}`,
      })
    );
  }
};

const mergeExtraSeedRecords = (
  extraSeedMap: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>,
  tableId: core.TableId,
  recordIds: ReadonlyArray<string>
): Result<void, DomainError> => {
  if (recordIds.length === 0) return ok(undefined);

  const entry =
    extraSeedMap.get(tableId.toString()) ??
    ({
      tableId,
      recordIds: new Map<string, core.RecordId>(),
    } as const);

  for (const recordId of recordIds) {
    const recordIdResult = core.RecordId.create(recordId);
    if (recordIdResult.isErr()) return err(recordIdResult.error);
    entry.recordIds.set(recordIdResult.value.toString(), recordIdResult.value);
  }

  extraSeedMap.set(tableId.toString(), entry);
  return ok(undefined);
};

const finalizeExtraSeedRecords = (
  extraSeedMap: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>
): ExtraSeedRecordGroup[] => {
  return [...extraSeedMap.values()].map((entry) => ({
    tableId: entry.tableId,
    recordIds: [...entry.recordIds.values()],
  }));
};

const describeError = (error: unknown): string => {
  if (isDomainError(error)) return error.message;
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};

// Transaction context type for Postgres unit of work
interface PostgresTransactionContext<DB> {
  kind: 'unitOfWorkTransaction';
  db: Transaction<DB>;
}

const getPostgresTransaction = <DB>(context: core.IExecutionContext): Transaction<DB> | null => {
  const transaction = context.transaction as Partial<PostgresTransactionContext<DB>> | undefined;
  if (transaction?.kind === 'unitOfWorkTransaction' && transaction.db) {
    return transaction.db as Transaction<DB>;
  }
  return null;
};

/**
 * Resolves the correct database connection for the given context.
 * If the context has a transaction, returns the transaction connection.
 * Otherwise, returns the regular database connection.
 */
const resolvePostgresDb = <DB>(
  db: Kysely<DB>,
  context: core.IExecutionContext
): Kysely<DB> | Transaction<DB> => {
  return getPostgresTransaction<DB>(context) ?? db;
};
