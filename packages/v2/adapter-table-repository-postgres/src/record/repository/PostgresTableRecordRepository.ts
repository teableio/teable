import * as core from '@teable/v2-core';
import {
  domainError,
  type ILogger,
  v2CoreTokens,
  type DomainError,
  type IHasher,
  generateUuid,
  type RecordMutationResult,
  type BatchRecordMutationResult,
  type InsertOptions,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Expression, type Kysely, type SqlBool, type Transaction } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { describeError, wrapDatabaseError } from '../../shared/errors';
import type {
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
  ComputedUpdateResult,
  IUpdateStrategy,
  UpdateImpactHint,
  IComputedUpdateOutbox,
} from '../computed';
import { buildSeedTaskInput } from '../computed';
import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB } from '../query-builder';
import {
  RecordInsertBuilder,
  type CompiledSqlStatement,
  type LinkedRecordLockInfo,
  type InsertExclusivityConstraint,
} from '../query-builder/insert/RecordInsertBuilder';
import { BatchRecordUpdateBuilder } from '../query-builder/update/BatchRecordUpdateBuilder';
import { buildBatchUpdateSql } from '../query-builder/update/BatchUpdateSqlBuilder';
import { RecordUpdateBuilder } from '../query-builder/update/RecordUpdateBuilder';
import {
  TableRecordConditionWhereVisitor,
  FieldDeleteValueVisitor,
  type OutgoingLinkDeleteOp,
} from '../visitors';
import type { LinkExclusivityConstraint } from '../visitors/LinkExclusivityConstraintCollector';

// System columns (kept for update operations)
const RECORD_ID_COLUMN = '__id';
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
 * View order information for a table.
 * Maps view row order column names to their current max order values.
 */
type ViewOrderInfo = Map<string, number>;

/**
 * Internal insert options that extend core InsertOptions with PostgreSQL-specific flags.
 */
interface InternalInsertManyOptions extends core.InsertOptions {
  /**
   * When true, computed field updates are skipped entirely.
   * Used by insertManyStream with deferComputedUpdates to batch all updates at the end.
   */
  skipComputedUpdates?: boolean;
}

/**
 * Get view order information for all views in a table.
 * Queries the max row order value for each view's order column.
 * Only includes columns that actually exist in the table schema.
 */
async function getViewOrderInfo(
  db: Kysely<DynamicDB>,
  tableName: string,
  views: ReadonlyArray<core.View>
): Promise<ViewOrderInfo> {
  const viewOrderInfo: ViewOrderInfo = new Map();

  if (views.length === 0) {
    return viewOrderInfo;
  }

  // Get all potential order column names
  const potentialColumns = views.map((view) => view.id().toRowOrderColumnName());

  // First, check which columns actually exist in the table
  // Query the information_schema to find existing columns
  try {
    const existingColumnsResult = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = ${tableName}
      AND column_name = ANY(${sql.raw(`ARRAY[${potentialColumns.map((c) => `'${c}'`).join(',')}]`)})
    `.execute(db);

    const existingColumns = new Set(existingColumnsResult.rows.map((row) => row.column_name));

    // Filter to only columns that exist
    const columnNames = potentialColumns.filter((col) => existingColumns.has(col));

    if (columnNames.length === 0) {
      return viewOrderInfo;
    }

    // Query max values for existing order columns
    const selectParts = columnNames.map((col) =>
      sql<number>`COALESCE(MAX(${sql.ref(col)}), 0)`.as(col)
    );

    const result = await db.selectFrom(tableName).select(selectParts).executeTakeFirst();

    if (result) {
      for (const col of columnNames) {
        const maxValue = (result as Record<string, unknown>)[col];
        viewOrderInfo.set(col, typeof maxValue === 'number' ? maxValue : 0);
      }
    }
  } catch {
    // If query fails, return empty map
  }

  return viewOrderInfo;
}

/**
 * Build view order values for a record being inserted.
 * Each view gets order = currentMaxOrder + recordIndex + 1
 */
function buildViewOrderValues(
  viewOrderInfo: ViewOrderInfo,
  recordIndex: number
): Record<string, number> {
  const values: Record<string, number> = {};

  for (const [columnName, maxOrder] of viewOrderInfo) {
    values[columnName] = maxOrder + recordIndex + 1;
  }

  return values;
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
    @inject(v2CoreTokens.recordOrderCalculator)
    private readonly recordOrderCalculator: core.IRecordOrderCalculator,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly computedUpdatePlanner: ComputedUpdatePlanner,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldUpdater)
    private readonly computedFieldUpdater: ComputedFieldUpdater,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateStrategy)
    private readonly computedUpdateStrategy: IUpdateStrategy,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutbox)
    private readonly computedUpdateOutbox: IComputedUpdateOutbox,
    @inject(v2CoreTokens.hasher)
    private readonly hasher: IHasher
  ) {}

  async insert(
    context: core.IExecutionContext,
    table: core.Table,
    record: core.TableRecord,
    options?: InsertOptions
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return safeTry<RecordMutationResult, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const now = new Date().toISOString();
        const actorId = context.actorId.toString();
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

        // Get view order info for all views in the table
        const views = table.views();
        const viewOrderInfo = await getViewOrderInfo(db, tableName, views);

        // Use RecordInsertBuilder to build insert data
        const insertBuilder = new RecordInsertBuilder(db);
        const fieldValues = recordFieldsToMap(table, record);
        const {
          values,
          additionalStatements,
          linkedRecordLocks,
          exclusivityConstraints,
          extraSeedRecords,
        } = yield* insertBuilder.buildInsertData({
          table,
          fieldValues,
          context: {
            recordId: record.id().toString(),
            actorId: context.actorId.toString(),
            now,
          },
        });

        // Add view order columns (default: append to end)
        let viewOrderValues = buildViewOrderValues(viewOrderInfo, 0);

        // If ordering is specified, calculate order value for the target view
        if (options?.order) {
          const orderColumnName = options.order.viewId.toRowOrderColumnName();
          const orderValuesResult = await this.recordOrderCalculator.calculateOrders(
            context,
            table,
            options.order.viewId,
            options.order.anchorId,
            options.order.position,
            1
          );
          if (orderValuesResult.isErr()) {
            return err(orderValuesResult.error);
          }

          // Override the target view's order value
          viewOrderValues = {
            ...viewOrderValues,
            [orderColumnName]: orderValuesResult.value[0],
          };
        }

        const valuesWithViewOrder = {
          ...values,
          ...viewOrderValues,
        };

        // Convert InsertExtraSeedGroup to ExtraSeedRecordGroup
        const extraSeedRecordGroups: ExtraSeedRecordGroup[] = extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: group.recordIds,
        }));

        // Validate link exclusivity constraints for oneOne/oneMany relationships
        yield* await validateInsertExclusivityConstraints(db, exclusivityConstraints);

        this.logger.debug(`insert:table=${tableName}`, { values: valuesWithViewOrder });

        try {
          // Execute the main insert
          await db.insertInto(tableName).values(valuesWithViewOrder).execute();

          // Acquire advisory locks for linked records to prevent deadlocks
          const baseId = table.baseId().toString();
          await acquireLinkedRecordLocks(db, baseId, linkedRecordLocks);

          // Execute additional statements (junction inserts, FK updates, user field updates, etc.)
          await RecordInsertBuilder.executeStatements(db, additionalStatements);

          const computedResult = yield* await this.runComputedUpdate(
            context,
            table,
            record,
            'insert',
            undefined,
            extraSeedRecordGroups
          );
          // Extract computed changes for this specific record
          await this.touchTableMeta(db, table.id().toString(), actorId);
          const computedChanges = extractChangesForRecord(computedResult, record.id().toString());
          return ok({ computedChanges });
        } catch (error) {
          return err(wrapDatabaseError(error, 'insert', { tableName }));
        }
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
    records: ReadonlyArray<core.TableRecord>,
    options?: InternalInsertManyOptions
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return safeTry<BatchRecordMutationResult, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        if (records.length === 0) {
          return ok({});
        }

        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const now = new Date().toISOString();
        const actorId = context.actorId.toString();
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

        // Get view order info for all views in the table
        const views = table.views();
        const viewOrderInfo = await getViewOrderInfo(db, tableName, views);

        // Pre-calculate order values if ordering is specified
        let calculatedOrderValues: number[] | undefined;
        let orderColumnName: string | undefined;

        if (options?.order) {
          orderColumnName = options.order.viewId.toRowOrderColumnName();
          const orderValuesResult = await this.recordOrderCalculator.calculateOrders(
            context,
            table,
            options.order.viewId,
            options.order.anchorId,
            options.order.position,
            records.length
          );
          if (orderValuesResult.isErr()) {
            return err(orderValuesResult.error);
          }
          calculatedOrderValues = [...orderValuesResult.value];
        }

        // Use RecordInsertBuilder to build insert data for all records
        const insertBuilder = new RecordInsertBuilder(db);
        const allValues: Record<string, unknown>[] = [];
        const allAdditionalStatements: CompiledSqlStatement[] = [];
        const allLinkedRecordLocks: LinkedRecordLockInfo[] = [];
        const allExclusivityConstraints: InsertExclusivityConstraint[] = [];
        const allExtraSeedRecordsMap = new Map<
          string,
          { tableId: core.TableId; recordIds: Map<string, core.RecordId> }
        >();
        // Collect order values per record for undo/redo support
        const recordOrdersMap = new Map<string, Record<string, number>>();

        let recordIndex = 0;
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

          // Add view order columns for each view (default: append to end)
          let viewOrderValues = buildViewOrderValues(viewOrderInfo, recordIndex);

          // If ordering is specified, override the target view's order value
          if (calculatedOrderValues && orderColumnName) {
            viewOrderValues = {
              ...viewOrderValues,
              [orderColumnName]: calculatedOrderValues[recordIndex],
            };
          }

          const valuesWithViewOrder = {
            ...insertDataResult.value.values,
            ...viewOrderValues,
          };

          // Store order values for this record (convert column names to view IDs)
          const recordId = record.id().toString();
          const ordersByViewId: Record<string, number> = {};
          for (const [columnName, orderValue] of Object.entries(viewOrderValues)) {
            // Column name format: __row_{viewId}, extract viewId
            const viewId = columnName.replace('__row_', '');
            ordersByViewId[viewId] = orderValue;
          }
          if (Object.keys(ordersByViewId).length > 0) {
            recordOrdersMap.set(recordId, ordersByViewId);
          }

          allValues.push(valuesWithViewOrder);
          allAdditionalStatements.push(...insertDataResult.value.additionalStatements);
          allLinkedRecordLocks.push(...insertDataResult.value.linkedRecordLocks);
          allExclusivityConstraints.push(...insertDataResult.value.exclusivityConstraints);

          // Collect extra seed records from all link fields
          for (const seedGroup of insertDataResult.value.extraSeedRecords) {
            const tableIdStr = seedGroup.tableId.toString();
            const entry = allExtraSeedRecordsMap.get(tableIdStr) ?? {
              tableId: seedGroup.tableId,
              recordIds: new Map<string, core.RecordId>(),
            };
            for (const recordId of seedGroup.recordIds) {
              entry.recordIds.set(recordId.toString(), recordId);
            }
            allExtraSeedRecordsMap.set(tableIdStr, entry);
          }

          recordIndex++;
        }

        // Convert Map to ExtraSeedRecordGroup array
        const allExtraSeedRecordGroups: ExtraSeedRecordGroup[] = [
          ...allExtraSeedRecordsMap.values(),
        ].map((entry) => ({
          tableId: entry.tableId,
          recordIds: [...entry.recordIds.values()],
        }));

        // Validate link exclusivity constraints:
        // 1. Check for cross-record duplicates within the same batch
        // 2. Check against existing database records
        yield* await validateInsertExclusivityConstraints(db, allExclusivityConstraints);

        this.logger.debug(`insertMany:table=${tableName}`, { count: records.length });

        try {
          // Execute batch inserts to stay under PG parameter limit
          const batchSize = PostgresTableRecordRepository.INSERT_BATCH_SIZE;
          for (let i = 0; i < allValues.length; i += batchSize) {
            const batch = allValues.slice(i, i + batchSize);
            await db.insertInto(tableName).values(batch).execute();
          }

          // Acquire advisory locks for linked records to prevent deadlocks
          const baseId = table.baseId().toString();
          await acquireLinkedRecordLocks(db, baseId, allLinkedRecordLocks);

          // Execute additional statements (junction inserts, FK updates, user field updates, etc.)
          await RecordInsertBuilder.executeStatements(db, allAdditionalStatements);

          // Run computed updates unless explicitly skipped (for deferred batch processing)
          let computedResult: ComputedUpdateResult | undefined;
          if (!options?.skipComputedUpdates) {
            computedResult = yield* await this.runComputedUpdateMany(
              context,
              table,
              records,
              'insert',
              allExtraSeedRecordGroups
            );
          }
          // Extract computed changes for all records
          await this.touchTableMeta(db, table.id().toString(), actorId);
          const computedChangesByRecord = extractChangesForAllRecords(computedResult);
          return ok({
            computedChangesByRecord,
            recordOrders: recordOrdersMap.size > 0 ? recordOrdersMap : undefined,
          });
        } catch (error) {
          return err(wrapDatabaseError(error, 'insert', { tableName }));
        }
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
    const deferComputed = options?.deferComputedUpdates ?? false;

    // When deferring computed updates, collect all records for final batch update
    const allInsertedRecords: core.TableRecord[] = [];

    // Handle both sync and async iterables
    const processBatch = async (batch: ReadonlyArray<core.TableRecord>) => {
      const result = await this.insertMany(context, table, batch, {
        skipComputedUpdates: deferComputed,
      });
      if (result.isErr()) {
        return result;
      }

      // Track records if deferring computed updates
      if (deferComputed) {
        allInsertedRecords.push(...batch);
      }

      totalInserted += batch.length;
      options?.onBatchInserted?.({
        batchIndex,
        insertedCount: batch.length,
        totalInserted,
        recordOrders: result.value.recordOrders,
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

    // Trigger deferred computed updates after all inserts complete
    if (deferComputed && allInsertedRecords.length > 0) {
      // Fire off computed updates asynchronously - don't await
      // This allows the HTTP response to return immediately
      void this.runComputedUpdateMany(
        context,
        table,
        allInsertedRecords,
        'insert',
        [] // extraSeedRecords not tracked in deferred mode
      ).then((result) => {
        if (result.isErr()) {
          this.logger.warn('computed:deferred:failed', {
            error: result.error.message,
            tableId: table.id().toString(),
            recordCount: allInsertedRecords.length,
          });
        }
      });
    }

    return ok({ totalInserted });
  }

  async updateOne(
    context: core.IExecutionContext,
    table: core.Table,
    recordId: core.RecordId,
    mutateSpec: core.ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return safeTry<RecordMutationResult, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();
        const recordIdStr = recordId.toString();
        const actorId = context.actorId.toString();
        const actorContext = context as core.IExecutionContext & {
          actorName?: string;
          actorEmail?: string;
        };
        const now = new Date().toISOString();

        // Use transaction-aware database connection
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

        // Use RecordUpdateBuilder to build all SQL statements from mutateSpec
        const updateBuilder = new RecordUpdateBuilder(db);
        const { mainUpdate, additionalStatements, impact, linkedRecordLocks } =
          yield* await updateBuilder.build({
            table,
            tableName,
            mutateSpec,
            recordId: recordIdStr,
            context: {
              actorId,
              now,
              actorName: actorContext.actorName,
              actorEmail: actorContext.actorEmail,
            },
          });
        const { impactHint, extraSeedRecords, exclusivityConstraints } = impact;

        // Validate link exclusivity constraints before persisting
        // This ensures that in oneMany/oneOne relationships, a foreign record
        // cannot be linked to multiple source records
        yield* await validateLinkExclusivityConstraints(db, exclusivityConstraints);

        try {
          // Execute main UPDATE statement
          await db.executeQuery(mainUpdate.compiled);

          // Acquire advisory locks for linked records to prevent deadlocks
          const baseId = table.baseId().toString();
          await acquireLinkedRecordLocks(db, baseId, linkedRecordLocks);

          // Execute additional statements (junction table updates, FK updates)
          for (const stmt of additionalStatements) {
            await db.executeQuery(stmt.compiled);
          }

          // Run computed field updates
          const computedResult = yield* await this.runComputedUpdateById(
            context,
            table,
            recordId,
            'update',
            impactHint,
            extraSeedRecords
          );
          // Extract computed changes for this specific record
          await this.touchTableMeta(db, table.id().toString(), actorId);
          const computedChanges = extractChangesForRecord(computedResult, recordIdStr);
          return ok({ computedChanges });
        } catch (error) {
          return err(wrapDatabaseError(error, 'update', { tableName, recordId: recordIdStr }));
        }
      }.bind(this)
    );
  }

  async updateManyStream(
    context: core.IExecutionContext,
    table: core.Table,
    batches: Generator<Result<ReadonlyArray<core.RecordUpdateResult>, core.DomainError>>,
    options?: core.UpdateManyStreamOptions
  ): Promise<Result<core.UpdateManyStreamResult, DomainError>> {
    return safeTry<core.UpdateManyStreamResult, DomainError>(
      async function* (this: PostgresTableRecordRepository) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();
        const now = new Date().toISOString();
        const actorId = context.actorId.toString();
        const actorContext = context as core.IExecutionContext & {
          actorName?: string;
          actorEmail?: string;
        };
        const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

        let totalUpdated = 0;
        let batchIndex = 0;
        const allRecordIds: core.RecordId[] = [];
        const allChangedFieldIds = new Map<string, core.FieldId>();

        // Process each batch from the generator
        for (const batchResult of batches) {
          if (batchResult.isErr()) {
            return err(batchResult.error);
          }

          const batch = batchResult.value;
          if (batch.length === 0) {
            continue;
          }

          // Convert batch to BatchRecordUpdateInput format
          const updates: Array<{ recordId: core.RecordId; mutateSpec: core.ICellValueSpec }> =
            batch.map((updateResult) => ({
              recordId: updateResult.record.id(),
              mutateSpec: updateResult.mutateSpec,
            }));

          // Use BatchRecordUpdateBuilder to build batch update data
          const batchUpdateBuilder = new BatchRecordUpdateBuilder(db);
          const batchDataResult = yield* await batchUpdateBuilder.buildBatchUpdateData({
            table,
            tableName,
            updates,
            context: {
              actorId: context.actorId.toString(),
              now,
              actorName: actorContext.actorName,
              actorEmail: actorContext.actorEmail,
            },
          });

          const {
            columnUpdateData,
            additionalStatements,
            linkedRecordLocks,
            impact,
            systemColumns,
          } = batchDataResult;

          try {
            // Generate and execute batch UPDATE SQL
            const updateSqlResult = buildBatchUpdateSql({
              tableName,
              columnUpdateData,
              systemColumns,
              table,
              db,
            });
            if (updateSqlResult.isErr()) {
              return err(updateSqlResult.error);
            }

            await db.executeQuery(updateSqlResult.value);

            // Acquire advisory locks for linked records (deduplicated, single query)
            const baseId = table.baseId().toString();
            await acquireLinkedRecordLocks(db, baseId, linkedRecordLocks);

            // Execute additional statements (junction tables, FK updates)
            for (const stmt of additionalStatements) {
              await db.executeQuery(stmt.compiled);
            }

            // Track aggregated data for computed updates
            for (const update of updates) {
              allRecordIds.push(update.recordId);
            }
            // Collect both value and link field IDs for computed field triggering
            for (const fieldId of impact.valueFieldIds) {
              allChangedFieldIds.set(fieldId.toString(), fieldId);
            }
            for (const fieldId of impact.impactHint.linkFieldIds) {
              allChangedFieldIds.set(fieldId.toString(), fieldId);
            }

            totalUpdated += batch.length;
            options?.onBatchUpdated?.({
              batchIndex,
              updatedCount: batch.length,
              totalUpdated,
            });
            batchIndex++;
          } catch (error) {
            return err(wrapDatabaseError(error, 'update', { tableName }));
          }
        }

        // Trigger computed field updates once after all batches
        if (totalUpdated > 0) {
          const computedResult = await this.runComputedUpdateManyByIds(
            context,
            table,
            allRecordIds,
            [...allChangedFieldIds.values()]
          );
          if (computedResult.isErr()) {
            return err(computedResult.error);
          }
          await this.touchTableMeta(db, table.id().toString(), actorId);
        }

        return ok({ totalUpdated });
      }.bind(this)
    );
  }

  /**
   * Trigger computed updates for multiple records by IDs.
   * Used by updateManyStream to batch computed updates.
   */
  private async runComputedUpdateManyByIds(
    context: core.IExecutionContext,
    table: core.Table,
    recordIds: ReadonlyArray<core.RecordId>,
    changedFieldIds: ReadonlyArray<core.FieldId>
  ): Promise<Result<void, DomainError>> {
    if (recordIds.length === 0 || changedFieldIds.length === 0) {
      return ok(undefined);
    }

    // Always plan first — if no steps, skip entirely (both sync and async)
    const planInput = {
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [...recordIds],
      extraSeedRecords: [],
      changedFieldIds: [...changedFieldIds],
      changeType: 'update' as const,
      cyclePolicy: 'skip' as const,
      impact: {
        valueFieldIds: changedFieldIds,
        linkFieldIds: [] as core.FieldId[],
      },
      table,
    };

    const planResult = await this.computedUpdatePlanner.planStage(planInput, context);
    if (planResult.isErr()) {
      this.logger.warn('computed:seed:plan_batch_failed', {
        error: planResult.error.message,
        tableId: table.id().toString(),
        recordCount: recordIds.length,
      });
      return err(planResult.error);
    }

    const plan = planResult.value;
    if (plan.steps.length === 0) {
      return ok(undefined);
    }

    // For sync mode, execute directly
    if (this.computedUpdateStrategy.mode === 'sync') {
      const executeResult = await this.computedUpdateStrategy.execute(
        this.computedFieldUpdater,
        plan,
        context
      );
      if (executeResult.isErr()) {
        this.logger.warn('computed:seed:execute_batch_failed', {
          error: executeResult.error.message,
          tableId: table.id().toString(),
          recordCount: recordIds.length,
        });
        return err(executeResult.error);
      }

      return ok(undefined);
    }

    // For hybrid/async mode, use the outbox pattern
    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [...recordIds],
      extraSeedRecords: [],
      changedFieldIds: [...changedFieldIds],
      changeType: 'update',
      cyclePolicy: 'skip',
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
    });

    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:seed:enqueue_batch_update_failed', {
        error: enqueueResult.error.message,
        tableId: table.id().toString(),
        recordCount: recordIds.length,
      });
      return err(enqueueResult.error);
    }

    this.logger.debug('computed:seed:enqueued_batch_update', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      tableId: table.id().toString(),
      recordCount: recordIds.length,
      changedFieldCount: changedFieldIds.length,
    });

    this.computedUpdateStrategy.scheduleDispatch(context);

    return ok(undefined);
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
        const actorId = context.actorId.toString();
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

        // Collect link field operations using visitor pattern
        const deleteVisitor = FieldDeleteValueVisitor.create({
          recordIds: recordIdStrings,
        });

        const linkFieldOps: Array<{
          field: core.LinkField;
          operation: OutgoingLinkDeleteOp;
        }> = [];

        for (const field of table.getFields()) {
          const visitResult = field.accept(deleteVisitor);
          if (visitResult.isErr()) return err(visitResult.error);

          const { operation } = visitResult.value;
          if (operation && field.type().equals(core.FieldType.link())) {
            linkFieldOps.push({
              field: field as core.LinkField,
              operation,
            });
          }
        }

        // Collect extraSeedRecords for all link fields using batch query (O(linkFields) queries instead of O(records × linkFields))
        for (const { field: linkField } of linkFieldOps) {
          const linkRecordsMap = yield* await loadExistingLinkRecordIdsBatch(
            db,
            tableName,
            recordIdStrings,
            linkField
          );

          // Flatten all linked record IDs for this field
          const allLinkedIds: string[] = [];
          for (const linkedIds of linkRecordsMap.values()) {
            for (const id of linkedIds) {
              if (!allLinkedIds.includes(id)) {
                allLinkedIds.push(id);
              }
            }
          }

          const mergeResult = mergeExtraSeedRecords(
            extraSeedMap,
            linkField.foreignTableId(),
            allLinkedIds
          );
          if (mergeResult.isErr()) return err(mergeResult.error);
        }

        // Load incoming link fields (link fields from OTHER tables that point to THIS table)
        const incomingFieldsResult = await loadIncomingLinkFields(
          db,
          table.baseId().toString(),
          table.id().toString()
        );
        if (incomingFieldsResult.isErr()) return err(incomingFieldsResult.error);
        const incomingFields = incomingFieldsResult.value;

        // Collect extra seed records from incoming links (BEFORE cleanup)
        const incomingSeedsResult = await collectIncomingLinkExtraSeedRecords(
          db,
          recordIdStrings,
          incomingFields,
          extraSeedMap
        );
        if (incomingSeedsResult.isErr()) return err(incomingSeedsResult.error);

        // Execute incoming link cleanup (clean FK/junction pointing TO deleted records)
        const incomingCleanupResult = await executeIncomingLinkCleanup(
          db,
          recordIdStrings,
          incomingFields,
          tableName, // Pass target table name to skip symmetric link cleanup
          table.id().toString() // Pass target table ID to detect self-referential links
        );
        if (incomingCleanupResult.isErr()) return err(incomingCleanupResult.error);

        // Execute all outgoing delete operations
        for (const { operation } of linkFieldOps) {
          await executeOutgoingLinkDeleteOp(db, recordIdStrings, operation);
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
          await this.touchTableMeta(db, table.id().toString(), actorId);
        } catch (error) {
          return err(wrapDatabaseError(error, 'delete', { tableName, count: recordIds.length }));
        }

        return ok(undefined);
      }.bind(this)
    );
  }

  private async touchTableMeta(
    db: Kysely<DynamicDB>,
    tableId: string,
    actorId: string
  ): Promise<void> {
    await db
      .updateTable('table_meta')
      .set({
        last_modified_time: new Date(),
        last_modified_by: actorId,
      })
      .where('id', '=', tableId)
      .execute();
  }

  private async runComputedUpdate(
    context: core.IExecutionContext,
    table: core.Table,
    record: core.TableRecord,
    changeType: 'insert' | 'update' | 'delete',
    impact: UpdateImpactHint | undefined = undefined,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = []
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    const changedFieldIds = record
      .fields()
      .entries()
      .map((entry) => entry.fieldId);

    // If no changed fields, nothing to compute
    if (changedFieldIds.length === 0) {
      return ok(undefined);
    }

    // For sync mode, plan and execute directly without using the outbox
    if (this.computedUpdateStrategy.mode === 'sync') {
      const planInput = {
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [record.id()],
        extraSeedRecords: extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: [...group.recordIds],
        })),
        changedFieldIds,
        changeType,
        cyclePolicy: 'skip' as const,
        impact: impact
          ? {
              valueFieldIds: impact.valueFieldIds,
              linkFieldIds: impact.linkFieldIds,
            }
          : undefined,
        table,
      };

      const planResult = await this.computedUpdatePlanner.planStage(planInput, context);
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordId: record.id().toString(),
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      if (plan.steps.length > 0) {
        const executeResult = await this.computedUpdateStrategy.execute(
          this.computedFieldUpdater,
          plan,
          context
        );
        if (executeResult.isErr()) {
          this.logger.warn('computed:seed:execute_failed', {
            error: executeResult.error.message,
            tableId: table.id().toString(),
            recordId: record.id().toString(),
          });
          return err(executeResult.error);
        }
        return ok(executeResult.value);
      }

      return ok(undefined);
    }

    // For hybrid/async mode, use the outbox pattern
    // Build seed task input - only store minimal trigger information
    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [record.id()],
      extraSeedRecords: extraSeedRecords.map((group) => ({
        tableId: group.tableId,
        recordIds: [...group.recordIds],
      })),
      changedFieldIds,
      changeType,
      cyclePolicy: 'skip',
      impact: impact
        ? {
            valueFieldIds: impact.valueFieldIds,
            linkFieldIds: impact.linkFieldIds,
          }
        : undefined,
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
    });

    // Enqueue seed task - plan computation and execution happens asynchronously in the worker
    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:seed:enqueue_failed', {
        error: enqueueResult.error.message,
        tableId: table.id().toString(),
        recordId: record.id().toString(),
        changeType,
      });
      return err(enqueueResult.error);
    }

    this.logger.debug('computed:seed:enqueued', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      tableId: table.id().toString(),
      recordId: record.id().toString(),
      changeType,
      changedFieldCount: changedFieldIds.length,
    });

    // Schedule dispatch to process the enqueued task
    this.computedUpdateStrategy.scheduleDispatch(context);

    // Async mode doesn't return computed changes
    return ok(undefined);
  }

  private async runComputedUpdateMany(
    context: core.IExecutionContext,
    table: core.Table,
    records: ReadonlyArray<core.TableRecord>,
    changeType: 'insert' | 'update' | 'delete',
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = []
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    if (records.length === 0) return ok(undefined);
    const fieldIds = new Map<string, core.FieldId>();
    const recordIds: core.RecordId[] = [];

    for (const record of records) {
      recordIds.push(record.id());
      for (const entry of record.fields().entries()) {
        fieldIds.set(entry.fieldId.toString(), entry.fieldId);
      }
    }

    // For insert operations, include ALL fields from the table as "changed" fields.
    // This ensures formulas that depend on fields not explicitly provided (which have null values)
    // are still computed. For example, a formula like {textField} + '' should return ''
    // even if textField was not provided in the input.
    if (changeType === 'insert') {
      for (const field of table.getFields()) {
        const fieldId = field.id();
        fieldIds.set(fieldId.toString(), fieldId);
      }
    }

    const changedFieldIds = [...fieldIds.values()];

    // If no changed fields, nothing to compute
    if (changedFieldIds.length === 0) {
      return ok(undefined);
    }

    // For sync mode, plan and execute directly without using the outbox
    if (this.computedUpdateStrategy.mode === 'sync') {
      const planInput = {
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: recordIds,
        extraSeedRecords: extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: [...group.recordIds],
        })),
        changedFieldIds,
        changeType,
        cyclePolicy: 'skip' as const,
        table,
      };

      const planResult = await this.computedUpdatePlanner.planStage(planInput, context);
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_many_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordCount: recordIds.length,
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      if (plan.steps.length > 0) {
        const executeResult = await this.computedUpdateStrategy.execute(
          this.computedFieldUpdater,
          plan,
          context
        );
        if (executeResult.isErr()) {
          this.logger.warn('computed:seed:execute_many_failed', {
            error: executeResult.error.message,
            tableId: table.id().toString(),
            recordCount: recordIds.length,
          });
          return err(executeResult.error);
        }
        return ok(executeResult.value);
      }

      return ok(undefined);
    }

    // For hybrid/async mode, use the outbox pattern
    // Build seed task input - only store minimal trigger information
    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: recordIds,
      extraSeedRecords: extraSeedRecords.map((group) => ({
        tableId: group.tableId,
        recordIds: [...group.recordIds],
      })),
      changedFieldIds,
      changeType,
      cyclePolicy: 'skip',
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
    });

    // Enqueue seed task - plan computation and execution happens asynchronously in the worker
    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:seed:enqueue_many_failed', {
        error: enqueueResult.error.message,
        tableId: table.id().toString(),
        recordCount: recordIds.length,
        changeType,
      });
      return err(enqueueResult.error);
    }

    this.logger.debug('computed:seed:enqueued_many', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      tableId: table.id().toString(),
      recordCount: recordIds.length,
      changeType,
      changedFieldCount: changedFieldIds.length,
    });

    // Schedule dispatch to process the enqueued task
    this.computedUpdateStrategy.scheduleDispatch(context);

    // Async mode doesn't return computed changes
    return ok(undefined);
  }

  private async runComputedUpdateById(
    context: core.IExecutionContext,
    table: core.Table,
    recordId: core.RecordId,
    changeType: 'insert' | 'update' | 'delete',
    impact: UpdateImpactHint | undefined = undefined,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = []
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    // Get changed field IDs from impact hint (value fields + link fields)
    const changedFieldIds: core.FieldId[] = [];
    if (impact) {
      changedFieldIds.push(...impact.valueFieldIds, ...impact.linkFieldIds);
    }

    // If no changed fields, nothing to compute
    if (changedFieldIds.length === 0) {
      return ok(undefined);
    }

    // For sync mode, plan and execute directly without using the outbox
    if (this.computedUpdateStrategy.mode === 'sync') {
      const planInput = {
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [recordId],
        extraSeedRecords: extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: [...group.recordIds],
        })),
        changedFieldIds,
        changeType,
        cyclePolicy: 'skip' as const,
        impact: impact
          ? {
              valueFieldIds: impact.valueFieldIds,
              linkFieldIds: impact.linkFieldIds,
            }
          : undefined,
        table,
      };

      const planResult = await this.computedUpdatePlanner.planStage(planInput, context);
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordId: recordId.toString(),
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      if (plan.steps.length > 0) {
        const executeResult = await this.computedUpdateStrategy.execute(
          this.computedFieldUpdater,
          plan,
          context
        );
        if (executeResult.isErr()) {
          this.logger.warn('computed:seed:execute_failed', {
            error: executeResult.error.message,
            tableId: table.id().toString(),
            recordId: recordId.toString(),
          });
          return err(executeResult.error);
        }
        return ok(executeResult.value);
      }

      return ok(undefined);
    }

    // For hybrid/async mode, use the outbox pattern
    // Build seed task input - only store minimal trigger information
    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: extraSeedRecords.map((group) => ({
        tableId: group.tableId,
        recordIds: [...group.recordIds],
      })),
      changedFieldIds,
      changeType,
      cyclePolicy: 'skip',
      impact: impact
        ? {
            valueFieldIds: impact.valueFieldIds,
            linkFieldIds: impact.linkFieldIds,
          }
        : undefined,
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
    });

    // Enqueue seed task - plan computation and execution happens asynchronously in the worker
    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:seed:enqueue_failed', {
        error: enqueueResult.error.message,
        tableId: table.id().toString(),
        recordId: recordId.toString(),
      });
      return err(enqueueResult.error);
    }

    this.logger.debug('computed:seed:enqueued', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      tableId: table.id().toString(),
      recordId: recordId.toString(),
      changedFieldIds: changedFieldIds.map((id) => id.toString()),
    });

    // Schedule dispatch to process the enqueued task
    this.computedUpdateStrategy.scheduleDispatch(context);

    // Async mode doesn't return computed changes
    return ok(undefined);
  }

  private async runComputedDeleteUpdateMany(
    context: core.IExecutionContext,
    table: core.Table,
    recordIds: ReadonlyArray<core.RecordId>,
    extraSeedRecords: ReadonlyArray<ExtraSeedRecordGroup> = []
  ): Promise<Result<void, DomainError>> {
    if (recordIds.length === 0) return ok(undefined);
    const changedFieldIds = table.getFields().map((field) => field.id());

    // If no fields, nothing to compute
    if (changedFieldIds.length === 0) {
      return ok(undefined);
    }

    // For sync mode, plan and execute directly without using the outbox
    if (this.computedUpdateStrategy.mode === 'sync') {
      const planInput = {
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [...recordIds],
        extraSeedRecords: extraSeedRecords.map((group) => ({
          tableId: group.tableId,
          recordIds: [...group.recordIds],
        })),
        changedFieldIds,
        changeType: 'delete' as const,
        cyclePolicy: 'skip' as const,
      };

      const planResult = await this.computedUpdatePlanner.planStage(planInput, context);
      if (planResult.isErr()) {
        this.logger.warn('computed:seed:plan_delete_many_failed', {
          error: planResult.error.message,
          tableId: table.id().toString(),
          recordCount: recordIds.length,
        });
        return err(planResult.error);
      }

      const plan = planResult.value;
      if (plan.steps.length > 0) {
        const executeResult = await this.computedUpdateStrategy.execute(
          this.computedFieldUpdater,
          plan,
          context
        );
        if (executeResult.isErr()) {
          this.logger.warn('computed:seed:execute_delete_many_failed', {
            error: executeResult.error.message,
            tableId: table.id().toString(),
            recordCount: recordIds.length,
          });
          return err(executeResult.error);
        }
      }

      return ok(undefined);
    }

    // For hybrid/async mode, use the outbox pattern
    // Build seed task input - only store minimal trigger information
    const seedTask = buildSeedTaskInput({
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [...recordIds],
      extraSeedRecords: extraSeedRecords.map((group) => ({
        tableId: group.tableId,
        recordIds: [...group.recordIds],
      })),
      changedFieldIds,
      changeType: 'delete',
      cyclePolicy: 'skip',
      hasher: this.hasher,
      runId: context.requestId ?? generateUuid(),
    });

    // Enqueue seed task - plan computation and execution happens asynchronously in the worker
    const enqueueResult = await this.computedUpdateOutbox.enqueueSeedTask(seedTask, context);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:seed:enqueue_delete_many_failed', {
        error: enqueueResult.error.message,
        tableId: table.id().toString(),
        recordCount: recordIds.length,
      });
      return err(enqueueResult.error);
    }

    this.logger.debug('computed:seed:enqueued_delete_many', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      tableId: table.id().toString(),
      recordCount: recordIds.length,
      changedFieldCount: changedFieldIds.length,
    });

    // Schedule dispatch to process the enqueued task
    this.computedUpdateStrategy.scheduleDispatch(context);

    return ok(undefined);
  }
}

/**
 * Extract computed field changes for a specific record from ComputedUpdateResult.
 *
 * @param result - The computed update result (may be undefined for async mode)
 * @param recordId - The ID of the record to extract changes for
 * @returns A map of fieldId -> newValue, or undefined if no changes
 */
const extractChangesForRecord = (
  result: ComputedUpdateResult | undefined,
  recordId: string
): ReadonlyMap<string, unknown> | undefined => {
  if (!result) return undefined;

  const changes = new Map<string, unknown>();
  for (const step of result.changesByStep) {
    for (const record of step.recordChanges) {
      if (record.recordId === recordId) {
        for (const change of record.changes) {
          changes.set(change.fieldId, change.newValue);
        }
      }
    }
  }
  return changes.size > 0 ? changes : undefined;
};

/**
 * Extract computed field changes for all records from ComputedUpdateResult.
 *
 * @param result - The computed update result (may be undefined for async mode)
 * @returns A map of recordId -> (fieldId -> newValue), or undefined if no changes
 */
const extractChangesForAllRecords = (
  result: ComputedUpdateResult | undefined
): ReadonlyMap<string, ReadonlyMap<string, unknown>> | undefined => {
  if (!result) return undefined;

  const changesByRecord = new Map<string, Map<string, unknown>>();
  for (const step of result.changesByStep) {
    for (const record of step.recordChanges) {
      let recordChanges = changesByRecord.get(record.recordId);
      if (!recordChanges) {
        recordChanges = new Map<string, unknown>();
        changesByRecord.set(record.recordId, recordChanges);
      }
      for (const change of record.changes) {
        recordChanges.set(change.fieldId, change.newValue);
      }
    }
  }
  return changesByRecord.size > 0 ? changesByRecord : undefined;
};

const resolveFkHostTableName = (field: core.LinkField): Result<string, DomainError> => {
  return field
    .fkHostTableName()
    .split({ defaultSchema: 'public' })
    .map((split) => (split.schema ? `${split.schema}.${split.tableName}` : split.tableName));
};

/**
 * Execute an outgoing link delete operation.
 * Takes the operation descriptor from FieldDeleteValueVisitor and executes it.
 */
const executeOutgoingLinkDeleteOp = async (
  db: Kysely<DynamicDB>,
  recordIds: ReadonlyArray<string>,
  operation: OutgoingLinkDeleteOp
): Promise<void> => {
  if (recordIds.length === 0) return;

  if (operation.type === 'junction-delete') {
    await db
      .deleteFrom(operation.tableName)
      .where(operation.selfKeyName, 'in', recordIds as string[])
      .execute();
  } else if (operation.type === 'fk-nullify') {
    const updateValues: Record<string, null> = {
      [operation.selfKeyName]: null,
    };
    if (operation.orderColumnName) {
      updateValues[operation.orderColumnName] = null;
    }
    await db
      .updateTable(operation.tableName)
      .set(updateValues)
      .where(operation.selfKeyName, 'in', recordIds as string[])
      .execute();
  }
};

/**
 * Batch load existing link record IDs for multiple records.
 * Returns a Map<recordId, linkedRecordIds[]> for a single link field.
 * This reduces O(records × linkFields) queries to O(linkFields) queries.
 */
const loadExistingLinkRecordIdsBatch = async (
  db: Kysely<DynamicDB>,
  tableName: string,
  recordIds: ReadonlyArray<string>,
  field: core.LinkField
): Promise<Result<Map<string, string[]>, DomainError>> => {
  const result = new Map<string, string[]>();
  if (recordIds.length === 0) return ok(result);

  // Initialize all records with empty arrays
  for (const recordId of recordIds) {
    result.set(recordId, []);
  }

  const relationship = field.relationship().toString();

  try {
    if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
      // Junction table: SELECT selfKey, foreignKey FROM junction WHERE selfKey IN (...)
      const junctionTableResult = resolveFkHostTableName(field);
      if (junctionTableResult.isErr()) return err(junctionTableResult.error);
      const selfKeyResult = field.selfKeyNameString();
      if (selfKeyResult.isErr()) return err(selfKeyResult.error);
      const foreignKeyResult = field.foreignKeyNameString();
      if (foreignKeyResult.isErr()) return err(foreignKeyResult.error);

      const rows = await db
        .selectFrom(junctionTableResult.value)
        .select([
          sql.ref(selfKeyResult.value).as('self_key'),
          sql.ref(foreignKeyResult.value).as('foreign_key'),
        ])
        .where(selfKeyResult.value, 'in', recordIds as string[])
        .execute();

      for (const row of rows) {
        const selfKey = row.self_key;
        const foreignKey = row.foreign_key;
        if (typeof selfKey === 'string' && typeof foreignKey === 'string') {
          const existing = result.get(selfKey) ?? [];
          existing.push(foreignKey);
          result.set(selfKey, existing);
        }
      }
      return ok(result);
    }

    if (relationship === 'manyOne' || relationship === 'oneOne') {
      // FK on current table: SELECT __id, fk FROM table WHERE __id IN (...)
      const foreignKeyResult = field.foreignKeyNameString();
      if (foreignKeyResult.isErr()) return err(foreignKeyResult.error);

      const rows = await db
        .selectFrom(tableName)
        .select([
          sql.ref(RECORD_ID_COLUMN).as('record_id'),
          sql.ref(foreignKeyResult.value).as('foreign_key'),
        ])
        .where(RECORD_ID_COLUMN, 'in', recordIds as string[])
        .execute();

      for (const row of rows) {
        const recordId = row.record_id;
        const foreignKey = row.foreign_key;
        if (typeof recordId === 'string' && typeof foreignKey === 'string') {
          result.set(recordId, [foreignKey]);
        }
      }
      return ok(result);
    }

    if (relationship === 'oneMany') {
      // FK on foreign table: SELECT selfKey, __id FROM foreignTable WHERE selfKey IN (...)
      const foreignTableResult = resolveFkHostTableName(field);
      if (foreignTableResult.isErr()) return err(foreignTableResult.error);
      const selfKeyResult = field.selfKeyNameString();
      if (selfKeyResult.isErr()) return err(selfKeyResult.error);

      const rows = await db
        .selectFrom(foreignTableResult.value)
        .select([
          sql.ref(selfKeyResult.value).as('self_key'),
          sql.ref(RECORD_ID_COLUMN).as('foreign_key'),
        ])
        .where(selfKeyResult.value, 'in', recordIds as string[])
        .execute();

      for (const row of rows) {
        const selfKey = row.self_key;
        const foreignKey = row.foreign_key;
        if (typeof selfKey === 'string' && typeof foreignKey === 'string') {
          const existing = result.get(selfKey) ?? [];
          existing.push(foreignKey);
          result.set(selfKey, existing);
        }
      }
      return ok(result);
    }

    return ok(result);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to batch load existing link records: ${describeError(error)}`,
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

/**
 * Build an advisory lock key for a linked record to prevent deadlocks.
 * The key format ensures consistent ordering across concurrent transactions.
 */
const buildLinkedRecordLockKey = (
  baseId: string,
  foreignTableId: string,
  foreignRecordId: string
): string => `v2:link:${baseId}:${foreignTableId}:${foreignRecordId}`;

/**
 * Acquire advisory locks for linked records to prevent deadlocks.
 * Locks are acquired in sorted key order to ensure consistent lock ordering.
 * Uses a single batch query to minimize database round-trips.
 */
const acquireLinkedRecordLocks = async (
  db: Kysely<DynamicDB>,
  baseId: string,
  linkedRecordLocks: ReadonlyArray<LinkedRecordLockInfo>
): Promise<void> => {
  if (linkedRecordLocks.length === 0) return;

  // Deduplicate and build lock keys
  const lockKeysSet = new Set<string>();
  for (const lock of linkedRecordLocks) {
    const key = buildLinkedRecordLockKey(baseId, lock.foreignTableId, lock.foreignRecordId);
    lockKeysSet.add(key);
  }

  // Sort keys to ensure consistent lock ordering across transactions
  const lockKeys = [...lockKeysSet].sort();

  if (lockKeys.length === 0) return;

  // Acquire all locks in a single batch query
  // Format array as PostgreSQL array literal: ARRAY['key1', 'key2', ...]
  const arrayLiteral = `ARRAY[${lockKeys.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')}]`;
  await db.executeQuery(
    sql`SELECT pg_advisory_xact_lock(('x' || substr(md5(k), 1, 16))::bit(64)::bigint)
        FROM unnest(${sql.raw(arrayLiteral)}::text[]) AS k
        ORDER BY k`.compile(db)
  );
};

/**
 * Validate link exclusivity constraints before persisting.
 *
 * For oneOne and oneMany relationships, each foreign record can only be linked
 * to ONE source record. This function checks if any of the foreign records
 * being newly linked are already linked to a different source record.
 *
 * @param db - Database connection
 * @param constraints - Array of exclusivity constraints to validate
 * @returns Ok if all constraints pass, Err with validation error if any fail
 */
const validateLinkExclusivityConstraints = async (
  db: Kysely<DynamicDB>,
  constraints: ReadonlyArray<LinkExclusivityConstraint>
): Promise<Result<void, DomainError>> => {
  if (constraints.length === 0) return ok(undefined);

  // Group constraints by fkHostTableName + query type to batch queries
  // Two types:
  // - Two-way links: FK is on foreign table, query by __id
  // - One-way links: FK is in junction table, query by foreignKeyName

  interface TwoWayQueryGroup {
    type: 'two-way';
    fkHostTableName: string;
    selfKeyName: string;
    // Map from foreignRecordId to sourceRecordId (to check each foreign record against its source)
    foreignRecordToSource: Map<string, string>;
    constraints: LinkExclusivityConstraint[];
  }

  interface OneWayQueryGroup {
    type: 'one-way';
    fkHostTableName: string; // junction table
    selfKeyName: string; // points to source
    foreignKeyName: string; // points to foreign
    // Map from foreignRecordId to sourceRecordId
    foreignRecordToSource: Map<string, string>;
    constraints: LinkExclusivityConstraint[];
  }

  type QueryGroup = TwoWayQueryGroup | OneWayQueryGroup;
  const queryGroups = new Map<string, QueryGroup>();

  for (const constraint of constraints) {
    // Skip if no foreign records to check
    if (constraint.addedForeignRecordIds.length === 0) continue;

    if (constraint.usesJunctionTable) {
      // Junction table: query by foreignKeyName (oneMany isOneWay)
      const groupKey = `junction::${constraint.fkHostTableName}::${constraint.foreignKeyName}`;
      const existing = queryGroups.get(groupKey) as OneWayQueryGroup | undefined;
      if (existing) {
        for (const id of constraint.addedForeignRecordIds) {
          existing.foreignRecordToSource.set(id, constraint.sourceRecordId);
        }
        existing.constraints.push(constraint);
      } else {
        const foreignRecordToSource = new Map<string, string>();
        for (const id of constraint.addedForeignRecordIds) {
          foreignRecordToSource.set(id, constraint.sourceRecordId);
        }
        queryGroups.set(groupKey, {
          type: 'one-way',
          fkHostTableName: constraint.fkHostTableName,
          selfKeyName: constraint.selfKeyName,
          foreignKeyName: constraint.foreignKeyName,
          foreignRecordToSource,
          constraints: [constraint],
        });
      }
    } else {
      // Two-way: query foreign table by __id
      const groupKey = `two-way::${constraint.fkHostTableName}::${constraint.selfKeyName}`;
      const existing = queryGroups.get(groupKey) as TwoWayQueryGroup | undefined;
      if (existing) {
        for (const id of constraint.addedForeignRecordIds) {
          existing.foreignRecordToSource.set(id, constraint.sourceRecordId);
        }
        existing.constraints.push(constraint);
      } else {
        const foreignRecordToSource = new Map<string, string>();
        for (const id of constraint.addedForeignRecordIds) {
          foreignRecordToSource.set(id, constraint.sourceRecordId);
        }
        queryGroups.set(groupKey, {
          type: 'two-way',
          fkHostTableName: constraint.fkHostTableName,
          selfKeyName: constraint.selfKeyName,
          foreignRecordToSource,
          constraints: [constraint],
        });
      }
    }
  }

  // Execute one query per group (instead of one per constraint)
  for (const [, group] of queryGroups) {
    if (group.foreignRecordToSource.size === 0) continue;

    try {
      if (group.type === 'two-way') {
        // Two-way: FK is on foreign table, query by __id
        const foreignRecordIds = [...group.foreignRecordToSource.keys()];
        const linkedRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(RECORD_ID_COLUMN).as('record_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(RECORD_ID_COLUMN, 'in', foreignRecordIds)
          .where(group.selfKeyName, 'is not', null)
          .execute();

        // Check each linked record against its expected source
        const conflictingRecords = linkedRecords.filter((r) => {
          const expectedSource = group.foreignRecordToSource.get(r.record_id as string);
          return r.linked_to !== expectedSource;
        });

        if (conflictingRecords.length > 0) {
          const conflictingIds = conflictingRecords.map((r) => r.record_id).join(', ');
          const firstConstraint = group.constraints[0];
          return err(
            domainError.validation({
              message: `Cannot link record(s) [${conflictingIds}]: already linked to another record. In one-to-many relationships, each record can only belong to one parent.`,
              code: 'validation.link.one_many_duplicate',
              details: {
                fieldId: firstConstraint.fieldId.toString(),
                conflictingRecordIds: conflictingRecords.map((r) => r.record_id),
                existingLinks: conflictingRecords.map((r) => ({
                  recordId: r.record_id,
                  linkedTo: r.linked_to,
                })),
              },
            })
          );
        }
      } else {
        // One-way: FK is in junction table, query by foreignKeyName
        const foreignRecordIds = [...group.foreignRecordToSource.keys()];
        const linkedRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(group.foreignKeyName).as('foreign_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(group.foreignKeyName, 'in', foreignRecordIds)
          .execute();

        // Check each linked record against its expected source
        const conflictingRecords = linkedRecords.filter((r) => {
          const expectedSource = group.foreignRecordToSource.get(r.foreign_id as string);
          return r.linked_to !== expectedSource;
        });

        if (conflictingRecords.length > 0) {
          const conflictingIds = conflictingRecords.map((r) => r.foreign_id).join(', ');
          const firstConstraint = group.constraints[0];
          return err(
            domainError.validation({
              message: `Cannot link record(s) [${conflictingIds}]: already linked to another record. In one-to-many relationships, each record can only belong to one parent.`,
              code: 'validation.link.one_many_duplicate',
              details: {
                fieldId: firstConstraint.fieldId.toString(),
                conflictingRecordIds: conflictingRecords.map((r) => r.foreign_id),
                existingLinks: conflictingRecords.map((r) => ({
                  recordId: r.foreign_id,
                  linkedTo: r.linked_to,
                })),
              },
            })
          );
        }
      }
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to validate link exclusivity: ${describeError(error)}`,
          code: 'infrastructure.database.validate_link_exclusivity_failed',
        })
      );
    }
  }

  return ok(undefined);
};

/**
 * Validate link exclusivity constraints for insert operations.
 *
 * This function performs two checks:
 * 1. Cross-record duplicates: In the same batch, multiple records trying to link
 *    the same foreign record (for oneOne and oneMany relationships)
 * 2. Database conflicts: Foreign records already linked to other existing records
 *
 * @param db - Database connection
 * @param constraints - Array of insert exclusivity constraints to validate
 * @returns Ok if all constraints pass, Err with validation error if any fail
 */
const validateInsertExclusivityConstraints = async (
  db: Kysely<DynamicDB>,
  constraints: ReadonlyArray<InsertExclusivityConstraint>
): Promise<Result<void, DomainError>> => {
  if (constraints.length === 0) return ok(undefined);

  // Group constraints by field ID for cross-record duplicate checking
  const constraintsByField = new Map<string, InsertExclusivityConstraint[]>();
  for (const constraint of constraints) {
    const fieldIdStr = constraint.fieldId.toString();
    const existing = constraintsByField.get(fieldIdStr) ?? [];
    existing.push(constraint);
    constraintsByField.set(fieldIdStr, existing);
  }

  // Check 1: Cross-record duplicates within the same batch
  for (const [fieldIdStr, fieldConstraints] of constraintsByField) {
    const seenForeignRecordIds = new Map<string, string>(); // foreignRecordId -> sourceRecordId

    for (const constraint of fieldConstraints) {
      for (const foreignRecordId of constraint.linkedForeignRecordIds) {
        const existingSourceId = seenForeignRecordIds.get(foreignRecordId);
        if (existingSourceId && existingSourceId !== constraint.sourceRecordId) {
          // Two different source records trying to link the same foreign record
          return err(
            domainError.validation({
              message: `Cannot link record ${foreignRecordId}: already linked by another record in the same batch. In one-to-many relationships, each record can only belong to one parent.`,
              code: 'validation.link.batch_duplicate',
              details: {
                fieldId: fieldIdStr,
                foreignRecordId,
                conflictingSourceRecords: [existingSourceId, constraint.sourceRecordId],
              },
            })
          );
        }
        seenForeignRecordIds.set(foreignRecordId, constraint.sourceRecordId);
      }
    }
  }

  // Check 2: Database conflicts - foreign records already linked to other existing records
  // Group constraints by fkHostTableName + query type to batch queries
  // Two types:
  // - Two-way links: FK is on foreign table, query by __id
  // - One-way links: FK is in junction table, query by foreignKeyName

  interface TwoWayQueryGroup {
    type: 'two-way';
    fkHostTableName: string;
    selfKeyName: string;
    foreignRecordIds: Set<string>;
    constraints: InsertExclusivityConstraint[];
  }

  interface OneWayQueryGroup {
    type: 'one-way';
    fkHostTableName: string; // junction table
    selfKeyName: string; // points to source
    foreignKeyName: string; // points to foreign
    foreignRecordIds: Set<string>;
    sourceRecordIds: Set<string>; // to exclude self-links
    constraints: InsertExclusivityConstraint[];
  }

  type QueryGroup = TwoWayQueryGroup | OneWayQueryGroup;
  const queryGroups = new Map<string, QueryGroup>();

  for (const constraint of constraints) {
    // Skip if no foreign records to check
    if (constraint.linkedForeignRecordIds.length === 0) continue;

    if (constraint.usesJunctionTable) {
      // Junction table: query by foreignKeyName (oneMany isOneWay, manyMany)
      const groupKey = `junction::${constraint.fkHostTableName}::${constraint.foreignKeyName}`;
      const existing = queryGroups.get(groupKey) as OneWayQueryGroup | undefined;
      if (existing) {
        for (const id of constraint.linkedForeignRecordIds) {
          existing.foreignRecordIds.add(id);
        }
        existing.sourceRecordIds.add(constraint.sourceRecordId);
        existing.constraints.push(constraint);
      } else {
        queryGroups.set(groupKey, {
          type: 'one-way',
          fkHostTableName: constraint.fkHostTableName,
          selfKeyName: constraint.selfKeyName,
          foreignKeyName: constraint.foreignKeyName,
          foreignRecordIds: new Set(constraint.linkedForeignRecordIds),
          sourceRecordIds: new Set([constraint.sourceRecordId]),
          constraints: [constraint],
        });
      }
    } else {
      // Two-way: query foreign table by __id
      const groupKey = `two-way::${constraint.fkHostTableName}::${constraint.selfKeyName}`;
      const existing = queryGroups.get(groupKey) as TwoWayQueryGroup | undefined;
      if (existing) {
        for (const id of constraint.linkedForeignRecordIds) {
          existing.foreignRecordIds.add(id);
        }
        existing.constraints.push(constraint);
      } else {
        queryGroups.set(groupKey, {
          type: 'two-way',
          fkHostTableName: constraint.fkHostTableName,
          selfKeyName: constraint.selfKeyName,
          foreignRecordIds: new Set(constraint.linkedForeignRecordIds),
          constraints: [constraint],
        });
      }
    }
  }

  // Execute one query per group (instead of one per constraint)
  for (const [, group] of queryGroups) {
    if (group.foreignRecordIds.size === 0) continue;

    try {
      if (group.type === 'two-way') {
        // Two-way: FK is on foreign table, query by __id
        const conflictingRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(RECORD_ID_COLUMN).as('record_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(RECORD_ID_COLUMN, 'in', [...group.foreignRecordIds])
          .where(group.selfKeyName, 'is not', null)
          .execute();

        if (conflictingRecords.length > 0) {
          const conflictingIds = conflictingRecords.map((r) => r.record_id).join(', ');
          const firstConstraint = group.constraints[0];
          return err(
            domainError.validation({
              message: `Cannot link record(s) [${conflictingIds}]: already linked to another record. In one-to-many relationships, each record can only belong to one parent.`,
              code: 'validation.link.one_many_duplicate',
              details: {
                fieldId: firstConstraint.fieldId.toString(),
                conflictingRecordIds: conflictingRecords.map((r) => r.record_id),
                existingLinks: conflictingRecords.map((r) => ({
                  recordId: r.record_id,
                  linkedTo: r.linked_to,
                })),
              },
            })
          );
        }
      } else {
        // One-way: FK is in junction table, query by foreignKeyName
        // Check if any foreign records are already linked to OTHER sources
        const conflictingRecords = await db
          .selectFrom(group.fkHostTableName)
          .select([
            sql.ref(group.foreignKeyName).as('foreign_id'),
            sql.ref(group.selfKeyName).as('linked_to'),
          ])
          .where(group.foreignKeyName, 'in', [...group.foreignRecordIds])
          .where(group.selfKeyName, 'not in', [...group.sourceRecordIds]) // Exclude our own records
          .execute();

        if (conflictingRecords.length > 0) {
          const conflictingIds = conflictingRecords.map((r) => r.foreign_id).join(', ');
          const firstConstraint = group.constraints[0];
          return err(
            domainError.validation({
              message: `Cannot link record(s) [${conflictingIds}]: already linked to another record. In one-to-many relationships, each record can only belong to one parent.`,
              code: 'validation.link.one_many_duplicate',
              details: {
                fieldId: firstConstraint.fieldId.toString(),
                conflictingRecordIds: conflictingRecords.map((r) => r.foreign_id),
                existingLinks: conflictingRecords.map((r) => ({
                  recordId: r.foreign_id,
                  linkedTo: r.linked_to,
                })),
              },
            })
          );
        }
      }
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to validate insert link exclusivity: ${describeError(error)}`,
          code: 'infrastructure.database.validate_insert_link_exclusivity_failed',
        })
      );
    }
  }

  return ok(undefined);
};

/**
 * Information about an incoming link field (a link field in another table that points to the target table).
 */
type IncomingLinkFieldInfo = {
  /** The table that has the link field */
  sourceTableId: string;
  /** The link field ID */
  fieldId: string;
  /** The relationship type */
  relationship: string;
  /** Whether it's a one-way link */
  isOneWay: boolean;
  /** FK host table name (schema.table format) */
  fkHostTableName: string;
  /** The column name for the foreign key (points to deleted records) */
  foreignKeyName: string;
  /** The column name for the self key (source record) - for junction tables */
  selfKeyName: string | null;
  /** Order column name if exists */
  orderColumnName: string | null;
};

/**
 * Query for incoming link fields - link fields from OTHER tables OR self-referential links
 * that have foreignTableId = targetTableId.
 * These are links where the deleted records are the TARGET of the link.
 */
const loadIncomingLinkFields = async (
  db: Kysely<DynamicDB>,
  baseId: string,
  targetTableId: string
): Promise<Result<IncomingLinkFieldInfo[], DomainError>> => {
  try {
    // Query for link fields where foreignTableId = targetTableId
    // This includes:
    // 1. Links from OTHER tables pointing TO targetTableId
    // 2. Self-referential links (same table links to itself)
    const rows = await db
      .selectFrom('field')
      .innerJoin('table_meta', 'table_meta.id', 'field.table_id')
      .select([
        'field.id as field_id',
        'field.table_id as source_table_id',
        'field.options as options',
      ])
      .where('table_meta.base_id', '=', baseId)
      .where('field.type', '=', 'link')
      .where('field.deleted_time', 'is', null)
      .where('field.is_lookup', 'is', null)
      .where(sql`(field.options::json->>'foreignTableId')::text`, '=', targetTableId)
      .execute();

    const result: IncomingLinkFieldInfo[] = [];

    for (const row of rows) {
      const options = typeof row.options === 'string' ? JSON.parse(row.options) : row.options;
      if (!options) continue;

      const relationship = options.relationship as string;
      const isOneWay = options.isOneWay === true;
      const fkHostTableName = options.fkHostTableName as string;
      const selfKeyName = options.selfKeyName as string | null;
      const foreignKeyName = options.foreignKeyName as string;

      // Determine what cleanup is needed based on relationship type
      // From the SOURCE table's perspective (the table that HAS the link field):
      // - manyOne: FK is on source table, keyed by TARGET record ID (foreignKeyName)
      // - oneOne: FK is on source table, keyed by TARGET record ID (foreignKeyName)
      // - manyMany: Junction table, need to delete rows where foreignKey matches deleted records
      // - oneMany (one-way): Junction table, need to delete rows where foreignKey matches deleted records
      // - oneMany (two-way): FK is on TARGET table - but that's handled by outgoing cleanup from target

      if (!fkHostTableName || !foreignKeyName) continue;

      result.push({
        sourceTableId: row.source_table_id as string,
        fieldId: row.field_id as string,
        relationship,
        isOneWay,
        fkHostTableName,
        foreignKeyName,
        selfKeyName: selfKeyName ?? null,
        orderColumnName: options.orderColumnName ?? null,
      });
    }

    return ok(result);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to load incoming link fields: ${describeError(error)}`,
        code: 'infrastructure.database.load_incoming_link_fields_failed',
      })
    );
  }
};

/**
 * Execute cleanup for incoming links - clean up FK/junction entries that point TO the deleted records.
 * Skips cleanup when fkHostTableName equals targetTableName AND it's not a self-referential link
 * (because the FK data will be deleted along with the records).
 */
const executeIncomingLinkCleanup = async (
  db: Kysely<DynamicDB>,
  recordIds: ReadonlyArray<string>,
  incomingFields: ReadonlyArray<IncomingLinkFieldInfo>,
  targetTableName: string,
  targetTableId: string
): Promise<Result<void, DomainError>> => {
  if (recordIds.length === 0 || incomingFields.length === 0) return ok(undefined);

  try {
    for (const field of incomingFields) {
      const {
        sourceTableId,
        relationship,
        isOneWay,
        fkHostTableName,
        foreignKeyName,
        orderColumnName,
      } = field;

      // Skip if FK is stored in the target table being deleted from
      // UNLESS it's a self-referential link (source table = target table)
      // For self-referential links, we need to nullify FKs in remaining records
      const isSelfReferential = sourceTableId === targetTableId;
      if (fkHostTableName === targetTableName && !isSelfReferential) continue;

      if (relationship === 'manyMany' || (relationship === 'oneMany' && isOneWay)) {
        // Junction table: delete rows where foreignKey matches deleted records
        await db
          .deleteFrom(fkHostTableName)
          .where(foreignKeyName, 'in', recordIds as string[])
          .execute();
      } else if (relationship === 'manyOne' || relationship === 'oneOne') {
        // FK on source table: nullify FK where it points to deleted records
        const updateValues: Record<string, null> = {
          [foreignKeyName]: null,
        };
        if (orderColumnName) {
          updateValues[orderColumnName] = null;
        }
        await db
          .updateTable(fkHostTableName)
          .set(updateValues)
          .where(foreignKeyName, 'in', recordIds as string[])
          .execute();
      }
      // For two-way oneMany: FK is on the target table (current table being deleted from),
      // which is handled by the outgoing link cleanup via FieldDeleteValueVisitor
    }

    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to execute incoming link cleanup: ${describeError(error)}`,
        code: 'infrastructure.database.incoming_link_cleanup_failed',
      })
    );
  }
};

/**
 * Collect extra seed records from incoming link fields.
 * These are records in OTHER tables that link TO the deleted records.
 */
const collectIncomingLinkExtraSeedRecords = async (
  db: Kysely<DynamicDB>,
  recordIds: ReadonlyArray<string>,
  incomingFields: ReadonlyArray<IncomingLinkFieldInfo>,
  extraSeedMap: Map<string, { tableId: core.TableId; recordIds: Map<string, core.RecordId> }>
): Promise<Result<void, DomainError>> => {
  if (recordIds.length === 0 || incomingFields.length === 0) return ok(undefined);

  try {
    for (const field of incomingFields) {
      const {
        sourceTableId,
        relationship,
        isOneWay,
        fkHostTableName,
        foreignKeyName,
        selfKeyName,
      } = field;

      let sourceRecordIds: string[] = [];

      if (relationship === 'manyMany' || (relationship === 'oneMany' && isOneWay)) {
        // Junction table: find source records that link to deleted records
        if (!selfKeyName) continue;
        const rows = await db
          .selectFrom(fkHostTableName)
          .select(sql.ref(selfKeyName).as('source_id'))
          .where(foreignKeyName, 'in', recordIds as string[])
          .execute();
        sourceRecordIds = rows
          .map((r) => r.source_id)
          .filter((id): id is string => typeof id === 'string');
      } else if (relationship === 'manyOne' || relationship === 'oneOne') {
        // FK on source table: find source records that link to deleted records
        // The FK host table IS the source table
        const rows = await db
          .selectFrom(fkHostTableName)
          .select(sql.ref('__id').as('source_id'))
          .where(foreignKeyName, 'in', recordIds as string[])
          .execute();
        sourceRecordIds = rows
          .map((r) => r.source_id)
          .filter((id): id is string => typeof id === 'string');
      } else if (relationship === 'oneMany' && !isOneWay) {
        // Two-way oneMany (symmetric link): FK is on the target table (being deleted from)
        // The deleted records' FK values point to the source table records that need seeding
        // selfKeyName contains B's record IDs stored in A's FK column
        if (!selfKeyName) continue;
        const rows = await db
          .selectFrom(fkHostTableName)
          .select(sql.ref(selfKeyName).as('foreign_id'))
          .where('__id', 'in', recordIds as string[])
          .execute();
        sourceRecordIds = rows
          .map((r) => r.foreign_id)
          .filter((id): id is string => typeof id === 'string');
      }

      // Merge into extraSeedMap
      if (sourceRecordIds.length > 0) {
        const tableIdResult = core.TableId.create(sourceTableId);
        if (tableIdResult.isErr()) return err(tableIdResult.error);
        const mergeResult = mergeExtraSeedRecords(
          extraSeedMap,
          tableIdResult.value,
          sourceRecordIds
        );
        if (mergeResult.isErr()) return err(mergeResult.error);
      }
    }

    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to collect incoming link extra seed records: ${describeError(error)}`,
        code: 'infrastructure.database.collect_incoming_link_seeds_failed',
      })
    );
  }
};
