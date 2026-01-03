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
import type { Kysely, Transaction } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

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
    private readonly logger: ILogger
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
    const repo = this;
    return safeTry<void, DomainError>(async function* () {
      const dbTableName = yield* table.dbTableName();
      const tableName = yield* dbTableName.value();

      const now = new Date().toISOString();
      const { values, queryExecutors } = repo.buildRecordInsertData(table, record, context, now);

      repo.logger.debug(`insert:table=${tableName}`, { values });

      // Use transaction-aware database connection
      const db = resolvePostgresDb(repo.db, context) as unknown as Kysely<DynamicDB>;

      try {
        // Execute the main insert
        await db.insertInto(tableName).values(values).execute();

        // Execute additional queries from visitors (junction inserts, FK updates, etc.)
        for (const executor of queryExecutors) {
          await executor(db);
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
    });
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
    const repo = this;
    return safeTry<void, DomainError>(async function* () {
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
        const { values, queryExecutors } = repo.buildRecordInsertData(table, record, context, now);
        allValues.push(values);
        allQueryExecutors.push(...queryExecutors);
      }

      repo.logger.debug(`insertMany:table=${tableName}`, { count: records.length });

      // Use transaction-aware database connection
      const db = resolvePostgresDb(repo.db, context) as unknown as Kysely<DynamicDB>;

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
    });
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
    _context: core.IExecutionContext,
    _table: core.Table,
    _record: core.TableRecord
  ): Promise<Result<void, DomainError>> {
    // TODO: Implement update using ICellValueSpecVisitor
    return err(domainError.unexpected({ message: 'Update not implemented yet' }));
  }

  async delete(
    context: core.IExecutionContext,
    table: core.Table,
    recordId: core.RecordId
  ): Promise<Result<void, DomainError>> {
    const repo = this;
    return safeTry<void, DomainError>(async function* () {
      const dbTableName = yield* table.dbTableName();
      const tableName = yield* dbTableName.value();

      // Use transaction-aware database connection
      const db = resolvePostgresDb(repo.db, context) as unknown as Kysely<DynamicDB>;

      try {
        await db.deleteFrom(tableName).where(RECORD_ID_COLUMN, '=', recordId.toString()).execute();
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
    });
  }
}

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
