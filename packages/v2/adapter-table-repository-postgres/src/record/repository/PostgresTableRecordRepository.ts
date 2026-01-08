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
import { sql, type Expression, type Kysely, type SqlBool, type Transaction } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type {
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
  IUpdateStrategy,
  UpdateImpactHint,
} from '../computed';
import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB } from '../query-builder';
import {
  RecordInsertBuilder,
  type CompiledSqlStatement,
} from '../query-builder/insert/RecordInsertBuilder';
import { RecordUpdateBuilder } from '../query-builder/update/RecordUpdateBuilder';
import {
  FieldInsertValueVisitor,
  LinkChangeCollectorVisitor,
  TableRecordConditionWhereVisitor,
  createEmptyCollectedLinkChanges,
  mergeCollectedLinkChange,
  type CollectedLinkChanges,
  type FieldInsertResult,
  type QueryExecutor,
} from '../visitors';

// System columns (kept for update operations)
const RECORD_ID_COLUMN = '__id';
const LAST_MODIFIED_TIME_COLUMN = '__last_modified_time';
const LAST_MODIFIED_BY_COLUMN = '__last_modified_by';
const VERSION_COLUMN = '__version';
// Note: __auto_number is a serial primary key - do NOT insert it manually

type ExtraSeedRecordGroup = {
  tableId: core.TableId;
  recordIds: core.RecordId[];
};

/**
 * Convert a TableRecord's fields to a Map<string, unknown> for use with RecordInsertBuilder.
 */
function recordFieldsToMap(table: core.Table, record: core.TableRecord): Map<string, unknown> {
  const fieldValues = new Map<string, unknown>();
  const recordFields = record.fields();

  for (const field of table.getFields()) {
    const cellValue = recordFields.get(field.id());
    const rawValue = cellValue?.toValue() ?? null;
    fieldValues.set(field.id().toString(), rawValue);
  }

  return fieldValues;
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
    private readonly logger: ILogger,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly computedUpdatePlanner: ComputedUpdatePlanner,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldUpdater)
    private readonly computedFieldUpdater: ComputedFieldUpdater,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateStrategy)
    private readonly computedUpdateStrategy: IUpdateStrategy
  ) {}

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
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

        // Use RecordInsertBuilder to build insert data
        const insertBuilder = new RecordInsertBuilder(db);
        const fieldValues = recordFieldsToMap(table, record);
        const insertDataResult = insertBuilder.buildInsertData({
          table,
          fieldValues,
          context: {
            recordId: record.id().toString(),
            actorId: context.actorId.toString(),
            now,
          },
        });

        if (insertDataResult.isErr()) {
          return err(insertDataResult.error);
        }

        const { values, additionalStatements } = insertDataResult.value;
        this.logger.debug(`insert:table=${tableName}`, { values });

        try {
          // Execute the main insert
          await db.insertInto(tableName).values(values).execute();

          // Execute additional statements (junction inserts, FK updates, etc.)
          await RecordInsertBuilder.executeStatements(db, additionalStatements);

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
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

        // Use RecordInsertBuilder to build insert data for all records
        const insertBuilder = new RecordInsertBuilder(db);
        const allValues: Record<string, unknown>[] = [];
        const allAdditionalStatements: CompiledSqlStatement[] = [];

        for (const record of records) {
          const fieldValues = recordFieldsToMap(table, record);
          const insertDataResult = insertBuilder.buildInsertData({
            table,
            fieldValues,
            context: {
              recordId: record.id().toString(),
              actorId: context.actorId.toString(),
              now,
            },
          });

          if (insertDataResult.isErr()) {
            return err(insertDataResult.error);
          }

          allValues.push(insertDataResult.value.values);
          allAdditionalStatements.push(...insertDataResult.value.additionalStatements);
        }

        this.logger.debug(`insertMany:table=${tableName}`, { count: records.length });

        try {
          // Execute batch inserts to stay under PG parameter limit
          const batchSize = PostgresTableRecordRepository.INSERT_BATCH_SIZE;
          for (let i = 0; i < allValues.length; i += batchSize) {
            const batch = allValues.slice(i, i + batchSize);
            await db.insertInto(tableName).values(batch).execute();
          }

          // Execute additional statements (junction inserts, FK updates, etc.)
          await RecordInsertBuilder.executeStatements(db, allAdditionalStatements);

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

  async updateOne(
    context: core.IExecutionContext,
    table: core.Table,
    recordId: core.RecordId,
    mutateSpec: core.ICellValueSpec
  ): Promise<Result<void, DomainError>> {
    return safeTry<void, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();
        const recordIdStr = recordId.toString();
        const actorId = context.actorId.toString();
        const now = new Date().toISOString();

        // Use transaction-aware database connection
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

        // Use RecordUpdateBuilder to build all SQL statements from mutateSpec
        const updateBuilder = new RecordUpdateBuilder(db);
        const buildResult = updateBuilder.build({
          table,
          tableName,
          mutateSpec,
          recordId: recordIdStr,
          context: { actorId, now },
        });
        if (buildResult.isErr()) {
          return err(buildResult.error);
        }
        const { mainUpdate, additionalStatements, changedFieldIds } = buildResult.value;

        try {
          // Execute main UPDATE statement
          await db.executeQuery(mainUpdate.compiled);

          // Execute additional statements (junction table updates, FK updates)
          for (const stmt of additionalStatements) {
            await db.executeQuery(stmt.compiled);
          }

          // Run computed field updates
          const computedResult = await this.runComputedUpdateById(
            context,
            table,
            recordId,
            'update',
            { valueFieldIds: changedFieldIds, linkFieldIds: [] },
            []
          );
          if (computedResult.isErr()) {
            return err(computedResult.error);
          }
        } catch (error) {
          return err(
            domainError.infrastructure({
              message: `Failed to update record: ${describeError(error)}`,
              code: 'infrastructure.database.update_failed',
              details: { tableName, recordId: recordIdStr, error: describeError(error) },
            })
          );
        }

        return ok(undefined);
      }.bind(this)
    );
  }

  async deleteMany(
    context: core.IExecutionContext,
    table: core.Table,
    spec: core.ISpecification<core.TableRecord, core.ITableRecordConditionSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return safeTry<void, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const whereVisitor = new TableRecordConditionWhereVisitor();
        const acceptResult = spec.accept(whereVisitor);
        if (acceptResult.isErr()) return err(acceptResult.error);
        const whereResult = whereVisitor.where();
        if (whereResult.isErr()) return err(whereResult.error);
        const whereClause = whereResult.value;

        // Use transaction-aware database connection
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
        const extraSeedMap = new Map<
          string,
          { tableId: core.TableId; recordIds: Map<string, core.RecordId> }
        >();

        const whereExpression = whereClause as unknown as Expression<SqlBool>;
        const recordIdRows = await db
          .selectFrom(tableName)
          .select(sql.ref(RECORD_ID_COLUMN).as('record_id'))
          .where(whereExpression)
          .execute();

        const recordIds: core.RecordId[] = [];
        const recordIdStrings: string[] = [];
        for (const row of recordIdRows) {
          const rawId = row.record_id;
          if (!rawId || typeof rawId !== 'string') {
            continue;
          }
          const recordIdResult = core.RecordId.create(rawId);
          if (recordIdResult.isErr()) return err(recordIdResult.error);
          recordIds.push(recordIdResult.value);
          recordIdStrings.push(rawId);
        }

        if (recordIds.length === 0) {
          return ok(undefined);
        }

        const linkFields = table
          .getFields()
          .filter((field): field is core.LinkField => field.type().equals(core.FieldType.link()));

        for (const recordIdValue of recordIdStrings) {
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
        }

        try {
          await db.deleteFrom(tableName).where(whereExpression).execute();

          const computedResult = await this.runComputedDeleteUpdateMany(
            context,
            table,
            recordIds,
            finalizeExtraSeedRecords(extraSeedMap)
          );
          if (computedResult.isErr()) {
            return err(computedResult.error);
          }
        } catch (error) {
          return err(
            domainError.infrastructure({
              message: `Failed to delete records: ${describeError(error)}`,
              code: 'infrastructure.database.delete_many_failed',
              details: { tableName, count: recordIds.length, error: describeError(error) },
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
    impact: UpdateImpactHint | undefined = undefined,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = []
  ): Promise<Result<void, DomainError>> {
    const changedFieldIds = record
      .fields()
      .entries()
      .map((entry) => entry.fieldId);
    const planResult = await this.computedUpdatePlanner.plan(
      {
        table,
        changedFieldIds,
        changedRecordIds: [record.id()],
        changeType,
        impact,
      },
      context
    );
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

    const planResult = await this.computedUpdatePlanner.plan(
      {
        table,
        changedFieldIds: [...fieldIds.values()],
        changedRecordIds: recordIds,
        changeType,
      },
      context
    );
    if (planResult.isErr()) return err(planResult.error);
    const plan = {
      ...planResult.value,
      extraSeedRecords,
    };
    return this.computedUpdateStrategy.execute(this.computedFieldUpdater, plan, context);
  }

  private async runComputedUpdateById(
    context: core.IExecutionContext,
    table: core.Table,
    recordId: core.RecordId,
    changeType: 'insert' | 'update' | 'delete',
    impact: UpdateImpactHint | undefined = undefined,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = []
  ): Promise<Result<void, DomainError>> {
    // Get changed field IDs from impact hint (value fields + link fields)
    const changedFieldIds: core.FieldId[] = [];
    if (impact) {
      changedFieldIds.push(...impact.valueFieldIds, ...impact.linkFieldIds);
    }

    const planResult = await this.computedUpdatePlanner.plan(
      {
        table,
        changedFieldIds,
        changedRecordIds: [recordId],
        changeType,
        impact,
      },
      context
    );
    if (planResult.isErr()) return err(planResult.error);
    const plan = {
      ...planResult.value,
      extraSeedRecords,
    };
    return this.computedUpdateStrategy.execute(this.computedFieldUpdater, plan, context);
  }

  private async runComputedDeleteUpdateMany(
    context: core.IExecutionContext,
    table: core.Table,
    recordIds: ReadonlyArray<core.RecordId>,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = []
  ): Promise<Result<void, DomainError>> {
    if (recordIds.length === 0) return ok(undefined);
    const allFieldIds = table.getFields().map((field) => field.id());
    const planResult = await this.computedUpdatePlanner.plan(
      {
        table,
        changedFieldIds: allFieldIds,
        changedRecordIds: [...recordIds],
        changeType: 'delete',
      },
      context
    );
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

// Note: classifyLinkChange logic has been moved to LinkChangeCollectorVisitor

const resolveFkHostTableName = (field: core.LinkField): Result<string, DomainError> => {
  return field
    .fkHostTableName()
    .split({ defaultSchema: 'public' })
    .map((split) => (split.schema ? `${split.schema}.${split.tableName}` : split.tableName));
};

const buildLinkUpdateOperationsFromItems = (
  field: core.LinkField,
  linkItems: ReadonlyArray<LinkItem>,
  recordId: string,
  seed: FieldInsertResult<DynamicDB> = { columnValues: {}, queryExecutors: [] }
): Result<FieldInsertResult<DynamicDB>, DomainError> => {
  return safeTry<FieldInsertResult<DynamicDB>, DomainError>(function* () {
    const { columnValues, queryExecutors } = seed;

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

  const orderColumnNameResult = field.hasOrderColumn() ? field.orderColumnName() : ok(null);
  if (orderColumnNameResult.isErr()) return err(orderColumnNameResult.error);
  const orderColumnName = orderColumnNameResult.value;

  const readRows = async (
    targetTable: string,
    columnName: string,
    whereColumn: string,
    orderColumn: string | null
  ) => {
    let query = db
      .selectFrom(targetTable)
      .select(sql.ref(columnName).as('record_id'))
      .where(whereColumn, '=', recordId);
    if (orderColumn) {
      query = query.orderBy(orderColumn, 'asc');
    }
    const rows = await query.execute();

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
        selfKeyResult.value,
        orderColumnName
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

      const rows = await readRows(
        foreignTableResult.value,
        RECORD_ID_COLUMN,
        selfKeyResult.value,
        orderColumnName
      );
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

const buildImpactHint = (
  valueFieldIds: ReadonlyArray<core.FieldId>,
  linkFieldIds: ReadonlyArray<core.FieldId>
): UpdateImpactHint => {
  return { valueFieldIds, linkFieldIds };
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
