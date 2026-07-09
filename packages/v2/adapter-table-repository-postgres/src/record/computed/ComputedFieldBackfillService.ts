import {
  Field,
  FieldType,
  TableByIdSpec,
  domainError,
  generatePrefixedId,
  type DomainError,
  type IComputedFieldBackfillService,
  type IExecutionContext,
  type IHasher,
  type ILogger,
  type ITableRepository,
  type ComputedFieldBackfillManyResult,
  type LinkField,
  type Table,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { formulaSqlPgTokens, type IPgTypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type Transaction } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB } from '../query-builder';
import { ComputedTableRecordQueryBuilder } from '../query-builder/computed';
import { isPersistedAsGeneratedColumn } from './isPersistedAsGeneratedColumn';
import { buildFieldBackfillTaskInput } from './outbox/FieldBackfillOutboxPayload';
import type { IComputedUpdateOutbox } from './outbox/IComputedUpdateOutbox';
import { UpdateFromSelectBuilder } from './UpdateFromSelectBuilder';

type ComputedFieldBackfillInput = {
  table: Table;
  field: Field;
};

export type { ComputedFieldBackfillManyResult } from '@teable/v2-core';

const BACKFILL_SYNC_FIELD_CHUNK_SIZE = 1;

const hasTrackedFieldIds = (
  field: Field
): field is Field & { trackedFieldIds: () => ReadonlyArray<unknown> } => {
  return 'trackedFieldIds' in field && typeof field.trackedFieldIds === 'function';
};

const chunkArray = <T>(items: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> => {
  if (size <= 0 || items.length <= size) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const hasUnitOfWorkTransaction = (context: IExecutionContext): boolean => {
  const transaction = context.transaction as { kind?: string } | undefined;
  return transaction?.kind === 'unitOfWorkTransaction';
};

/**
 * Configuration for field backfill behavior.
 */
export type FieldBackfillConfig = {
  /**
   * Strategy for backfill execution.
   * - 'sync': Execute immediately in current transaction
   * - 'async': Enqueue to outbox for background processing
   * - 'hybrid': Sync for small tables, async for large tables (default)
   */
  mode: 'sync' | 'async' | 'hybrid';

  /**
   * Row count threshold for hybrid mode.
   * Tables with more rows than this will use async mode.
   * Only applies when mode is 'hybrid'.
   * @default 10000
   */
  hybridThreshold: number;
};

export const defaultFieldBackfillConfig: FieldBackfillConfig = {
  mode: 'hybrid',
  hybridThreshold: 10000,
};

/**
 * Service to backfill computed field values when a new computed field is created.
 *
 * When a computed field (formula, lookup, rollup, conditionalLookup, conditionalRollup)
 * is created on a table that already has records, the existing records will have NULL
 * values for the new field. This service computes and stores values for all existing records.
 *
 * Key design decisions:
 * 1. Does NOT load record IDs into memory - uses SQL UPDATE directly
 * 2. No dirty table mechanism - updates all records in the table
 * 3. Single column update - new fields have no downstream dependencies
 * 4. Supports sync/async modes for different scale requirements
 *
 * @example
 * ```typescript
 * // Sync mode (explicit)
 * const result = await backfillService.backfill(context, {
 *   table,
 *   field: newFormulaField,
 * });
 *
 * // Async mode (enqueue to outbox)
 * const result = await backfillService.enqueue(context, {
 *   table,
 *   field: newFormulaField,
 * });
 * ```
 */
@injectable()
export class ComputedFieldBackfillService implements IComputedFieldBackfillService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.hasher)
    private readonly hasher: IHasher,
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutbox)
    private readonly outbox: IComputedUpdateOutbox,
    @inject(v2RecordRepositoryPostgresTokens.fieldBackfillConfig)
    private readonly config: FieldBackfillConfig = defaultFieldBackfillConfig,
    @inject(formulaSqlPgTokens.typeValidationStrategy)
    private readonly typeValidationStrategy: IPgTypeValidationStrategy
  ) {}

  /**
   * Backfill computed values for a newly created field.
   * Uses the configured mode (sync/async/hybrid) to determine execution strategy.
   *
   * @param context Execution context (may contain transaction)
   * @param input The table and field to backfill
   * @returns Result indicating success or error
   */
  async backfill(
    context: IExecutionContext,
    input: ComputedFieldBackfillInput
  ): Promise<Result<void, DomainError>> {
    // Only computed fields need backfill
    if (!this.needsBackfill(input.field)) {
      return ok(undefined);
    }

    // Determine execution mode
    const shouldAsync = await this.shouldUseAsyncMode(context, input.table);

    if (shouldAsync) {
      return this.enqueue(context, input);
    }

    const syncResult = await this.executeSync(context, input);
    if (syncResult.isOk()) {
      return syncResult;
    }

    return this.enqueueAfterSyncFailure(context, input, syncResult.error);
  }

  /**
   * Backfill multiple computed fields at once.
   * Useful when creating multiple fields in a single operation.
   *
   * @param context Execution context
   * @param input The table and fields to backfill
   * @returns Result indicating success or error
   */
  async backfillMany(
    context: IExecutionContext,
    input: {
      table: Table;
      fields: ReadonlyArray<Field>;
      skipDistinctFilter?: boolean;
      includeOneManyTwoWay?: boolean;
    }
  ): Promise<Result<ComputedFieldBackfillManyResult, DomainError>> {
    const computedFieldsResult = await this.collectBackfillFields(context, input);
    if (computedFieldsResult.isErr()) {
      return err(computedFieldsResult.error);
    }
    const computedFields = computedFieldsResult.value;
    if (computedFields.length === 0) {
      return ok({ fields: [] });
    }

    if (
      hasUnitOfWorkTransaction(context) &&
      computedFields.length > BACKFILL_SYNC_FIELD_CHUNK_SIZE
    ) {
      this.logger.info('computed:backfillMany:transaction_enqueue', {
        tableId: input.table.id().toString(),
        fieldIds: computedFields.map((field) => field.id().toString()),
      });
      const result = await this.enqueueMany(context, {
        table: input.table,
        fields: computedFields,
        includeOneManyTwoWay: input.includeOneManyTwoWay,
      });
      return result.map(() => ({ fields: computedFields }));
    }

    // Determine execution mode
    const shouldAsync = await this.shouldUseAsyncMode(context, input.table);

    if (shouldAsync) {
      const result = await this.enqueueMany(context, {
        table: input.table,
        fields: computedFields,
        includeOneManyTwoWay: input.includeOneManyTwoWay,
      });
      return result.map(() => ({ fields: computedFields }));
    }

    const syncResult = await this.executeSyncMany(context, {
      table: input.table,
      fields: computedFields,
      skipDistinctFilter: input.skipDistinctFilter,
      includeOneManyTwoWay: input.includeOneManyTwoWay,
    });
    if (syncResult.isOk()) {
      return syncResult;
    }

    const fallbackResult = await this.enqueueManyAfterSyncFailure(
      context,
      {
        table: input.table,
        fields: computedFields,
        includeOneManyTwoWay: input.includeOneManyTwoWay,
      },
      syncResult.error
    );
    return fallbackResult.map(() => ({ fields: computedFields }));
  }

  private async enqueueAfterSyncFailure(
    context: IExecutionContext,
    input: ComputedFieldBackfillInput,
    error: DomainError
  ): Promise<Result<void, DomainError>> {
    this.logger.warn('computed:backfill:sync_failed_enqueue_fallback', {
      tableId: input.table.id().toString(),
      fieldId: input.field.id().toString(),
      error: error.message,
    });

    const enqueueResult = await this.enqueue(context, input);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:backfill:enqueue_fallback_failed', {
        tableId: input.table.id().toString(),
        fieldId: input.field.id().toString(),
        error: error.message,
        fallbackError: enqueueResult.error.message,
      });
      return err(error);
    }

    return ok(undefined);
  }

  private async enqueueManyAfterSyncFailure(
    context: IExecutionContext,
    input: { table: Table; fields: ReadonlyArray<Field>; includeOneManyTwoWay?: boolean },
    error: DomainError
  ): Promise<Result<void, DomainError>> {
    this.logger.warn('computed:backfillMany:sync_failed_enqueue_fallback', {
      tableId: input.table.id().toString(),
      fieldIds: input.fields.map((field) => field.id().toString()),
      error: error.message,
    });

    const enqueueResult = await this.enqueueMany(context, input);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:backfillMany:enqueue_fallback_failed', {
        tableId: input.table.id().toString(),
        fieldIds: input.fields.map((field) => field.id().toString()),
        error: error.message,
        fallbackError: enqueueResult.error.message,
      });
      return err(error);
    }

    return ok(undefined);
  }

  /**
   * Enqueue a backfill task to the outbox for async processing.
   * Use this for large tables where sync execution would be too slow.
   */
  async enqueue(
    context: IExecutionContext,
    input: ComputedFieldBackfillInput
  ): Promise<Result<void, DomainError>> {
    if (!this.needsBackfill(input.field)) {
      return ok(undefined);
    }

    const taskInput = buildFieldBackfillTaskInput({
      baseId: input.table.baseId(),
      tableId: input.table.id(),
      fieldIds: [input.field.id()],
      hasher: this.hasher,
      runId: generatePrefixedId('bfr', 16),
    });

    this.logger.debug('computed:backfill:enqueue', {
      tableId: input.table.id().toString(),
      fieldId: input.field.id().toString(),
      runId: taskInput.runId,
    });

    const result = await this.outbox.enqueueFieldBackfill(taskInput, context);
    if (result.isErr()) {
      return err(result.error);
    }

    this.logger.info('computed:backfill:enqueued', {
      taskId: result.value.taskId,
      tableId: input.table.id().toString(),
      fieldId: input.field.id().toString(),
    });

    return ok(undefined);
  }

  /**
   * Enqueue a backfill task for multiple fields.
   */
  async enqueueMany(
    context: IExecutionContext,
    input: { table: Table; fields: ReadonlyArray<Field>; includeOneManyTwoWay?: boolean }
  ): Promise<Result<void, DomainError>> {
    const computedFields = input.fields.filter((f) =>
      this.needsBackfill(f, input.includeOneManyTwoWay)
    );
    if (computedFields.length === 0) {
      return ok(undefined);
    }

    const taskInput = buildFieldBackfillTaskInput({
      baseId: input.table.baseId(),
      tableId: input.table.id(),
      fieldIds: computedFields.map((f) => f.id()),
      hasher: this.hasher,
      runId: generatePrefixedId('bfr', 16),
    });

    this.logger.debug('computed:backfillMany:enqueue', {
      tableId: input.table.id().toString(),
      fieldIds: computedFields.map((f) => f.id().toString()),
      runId: taskInput.runId,
    });

    const result = await this.outbox.enqueueFieldBackfill(taskInput, context);
    if (result.isErr()) {
      return err(result.error);
    }

    this.logger.info('computed:backfillMany:enqueued', {
      taskId: result.value.taskId,
      tableId: input.table.id().toString(),
      fieldCount: computedFields.length,
    });

    return ok(undefined);
  }

  /**
   * Execute backfill synchronously (internal method).
   * This is called by the worker when processing async tasks.
   */
  async executeSync(
    context: IExecutionContext,
    input: ComputedFieldBackfillInput
  ): Promise<Result<void, DomainError>> {
    if (!this.needsBackfill(input.field)) {
      return ok(undefined);
    }

    const persistedAsGenerated = isPersistedAsGeneratedColumn(input.field);
    if (persistedAsGenerated.isErr()) return err(persistedAsGenerated.error);
    if (persistedAsGenerated.value) {
      // Generated columns compute automatically; do not backfill via UPDATE...FROM.
      return ok(undefined);
    }

    const db = this.resolveDb(context);
    const fieldId = input.field.id();

    this.logger.debug('computed:backfill:start', {
      tableId: input.table.id().toString(),
      fieldId: fieldId.toString(),
      fieldType: input.field.type().toString(),
    });

    return safeTry<void, DomainError>(
      async function* (this: ComputedFieldBackfillService) {
        // Build SELECT query for the computed field without dirty filter
        // This will select all records in the table
        const builder = new ComputedTableRecordQueryBuilder(db, {
          typeValidationStrategy: this.typeValidationStrategy,
          forceLookupArrayOutput: true,
          resolveSystemUserSnapshotsFromUsers: true,
        })
          .from(input.table)
          .select([fieldId]);
        // Note: NOT calling .withDirtyFilter() - we want all records

        // Prepare may load foreign tables for lookup/rollup fields
        yield* await builder.prepare({
          context,
          tableRepository: this.tableRepository,
        });

        const selectQuery = yield* builder.build();

        // Build UPDATE using UpdateFromSelectBuilder
        // Without dirtyFilter, it will update all records
        const updateBuilder = new UpdateFromSelectBuilder(db);
        const compiled = yield* updateBuilder.build({
          table: input.table,
          fieldIds: [fieldId],
          selectQuery,
          // Note: NOT passing dirtyFilter - update all records
        });

        this.logger.debug(`computed:backfill:sql\n${compiled.sql}`, {
          tableId: input.table.id().toString(),
          fieldId: fieldId.toString(),
          parameters: compiled.parameters,
        });

        // Execute the UPDATE
        try {
          const { numAffectedRows, numChangedRows } = await db.executeQuery(compiled);

          this.logger.debug('computed:backfill:done', {
            tableId: input.table.id().toString(),
            fieldId: fieldId.toString(),
            numAffectedRows,
            numChangedRows,
          });
        } catch (error) {
          const dbFieldName = input.field.dbFieldName().andThen((n) => n.value());
          return err(
            domainError.infrastructure({
              message: `Failed to backfill computed field ${fieldId.toString()} (dbFieldName=${dbFieldName.isOk() ? dbFieldName.value : 'unknown'}, table=${input.table.id().toString()}): ${error instanceof Error ? error.message : String(error)}`,
            })
          );
        }

        return ok(undefined);
      }.bind(this)
    );
  }

  /**
   * Execute backfill for multiple fields synchronously.
   */
  async executeSyncMany(
    context: IExecutionContext,
    input: {
      table: Table;
      fields: ReadonlyArray<Field>;
      skipDistinctFilter?: boolean;
      includeOneManyTwoWay?: boolean;
    }
  ): Promise<Result<ComputedFieldBackfillManyResult, DomainError>> {
    const computedFields = input.fields.filter((f) =>
      this.needsBackfill(f, input.includeOneManyTwoWay)
    );
    if (computedFields.length === 0) {
      return ok({ fields: [] });
    }

    const filtered: Field[] = [];
    for (const field of computedFields) {
      const persistedAsGenerated = isPersistedAsGeneratedColumn(field);
      if (persistedAsGenerated.isErr()) return err(persistedAsGenerated.error);
      if (!persistedAsGenerated.value) filtered.push(field);
    }
    if (filtered.length === 0) return ok({ fields: [] });

    const db = this.resolveDb(context);
    const fieldIds = filtered.map((f) => f.id());

    this.logger.debug('computed:backfillMany:start', {
      tableId: input.table.id().toString(),
      fieldIds: fieldIds.map((id) => id.toString()),
    });

    return safeTry<ComputedFieldBackfillManyResult, DomainError>(
      async function* (this: ComputedFieldBackfillService) {
        const fieldChunks = chunkArray(filtered, BACKFILL_SYNC_FIELD_CHUNK_SIZE);
        for (let index = 0; index < fieldChunks.length; index += 1) {
          const fields = fieldChunks[index]!;
          const chunkFieldIds = fields.map((f) => f.id());

          const builder = new ComputedTableRecordQueryBuilder(db, {
            typeValidationStrategy: this.typeValidationStrategy,
            forceLookupArrayOutput: true,
            resolveSystemUserSnapshotsFromUsers: true,
          })
            .from(input.table)
            .select(chunkFieldIds);

          yield* await builder.prepare({
            context,
            tableRepository: this.tableRepository,
          });

          const selectQuery = yield* builder.build();

          const updateBuilder = new UpdateFromSelectBuilder(db);
          const compiled = yield* updateBuilder.build({
            table: input.table,
            fieldIds: chunkFieldIds,
            selectQuery,
            skipDistinctFilter: input.skipDistinctFilter,
          });

          this.logger.debug('computed:backfillMany:sql', {
            tableId: input.table.id().toString(),
            fieldCount: chunkFieldIds.length,
            chunkIndex: index,
            chunkCount: fieldChunks.length,
            sql: compiled.sql,
          });

          try {
            await db.executeQuery(compiled);
          } catch (error) {
            const fieldDetails = fields
              .map((f) => {
                const dbName = f.dbFieldName().andThen((n) => n.value());
                return `${f.id().toString()}(dbFieldName=${dbName.isOk() ? dbName.value : 'unknown'})`;
              })
              .join(', ');
            return err(
              domainError.infrastructure({
                message: `Failed to backfill computed fields [${fieldDetails}] (table=${input.table.id().toString()}): ${error instanceof Error ? error.message : String(error)}`,
              })
            );
          }
        }

        this.logger.debug('computed:backfillMany:done', {
          tableId: input.table.id().toString(),
          fieldCount: fieldIds.length,
        });

        return ok({ fields: filtered });
      }.bind(this)
    );
  }

  /**
   * Check if a field requires backfill when added to a table.
   * This includes computed fields (formula, lookup, rollup, etc.) and
   * link fields (which store JSONB values derived from FK/junction relationships).
   */
  private needsBackfill(field: Field, includeOneManyTwoWay = false): boolean {
    if (
      (field.type().equals(FieldType.lastModifiedTime()) ||
        field.type().equals(FieldType.lastModifiedBy())) &&
      hasTrackedFieldIds(field) &&
      field.trackedFieldIds().length > 0
    ) {
      return false;
    }

    // Computed fields (formula, lookup, rollup, conditionalLookup, conditionalRollup)
    const specResult = Field.specs().isComputed().build();
    if (specResult.isOk() && specResult.value.isSatisfiedBy(field)) {
      return true;
    }
    // Link fields store JSONB values computed from FK/junction relationships.
    // When a symmetric link field is created (oneWay -> twoWay), it needs
    // backfill to populate its JSONB column from the existing relationship data.
    if (field.type().equals(FieldType.link())) {
      const linkField = field as unknown as LinkField;
      if (linkField.relationship().toString() === 'oneMany' && !linkField.isOneWay()) {
        return includeOneManyTwoWay;
      }
      return true;
    }
    return false;
  }

  private async collectBackfillFields(
    context: IExecutionContext,
    input: {
      table: Table;
      fields: ReadonlyArray<Field>;
      includeOneManyTwoWay?: boolean;
    }
  ): Promise<Result<Field[], DomainError>> {
    const service = this;
    return safeTry<Field[], DomainError>(async function* () {
      const fields: Field[] = [];
      for (const field of input.fields) {
        if (!service.needsBackfill(field, input.includeOneManyTwoWay)) {
          continue;
        }
        if (field.type().toString() !== 'link') {
          fields.push(field);
          continue;
        }

        const linkField = field as unknown as LinkField;
        const relationship = linkField.relationship().toString();
        const isTwoWayOneMany = relationship === 'oneMany' && !linkField.isOneWay();
        const usesJunctionTable =
          relationship === 'manyMany' || (relationship === 'oneMany' && linkField.isOneWay());
        const { schema, tableName } = yield* linkField
          .fkHostTableName()
          .split({ defaultSchema: null });
        let resolvedSchema = schema;
        let resolvedTableName = tableName;

        if (usesJunctionTable) {
          const selfKeyColumn = yield* linkField.selfKeyNameString();
          const foreignKeyColumn = yield* linkField.foreignKeyNameString();
          const selfKeyExists = yield* await service.columnExists(
            context,
            resolvedSchema,
            resolvedTableName,
            selfKeyColumn
          );
          const foreignKeyExists = yield* await service.columnExists(
            context,
            resolvedSchema,
            resolvedTableName,
            foreignKeyColumn
          );
          if (!selfKeyExists || !foreignKeyExists) {
            service.logger.debug('computed:backfillMany:skip_missing_junction_columns', {
              tableId: input.table.id().toString(),
              fieldId: field.id().toString(),
              resolvedSchema,
              resolvedTableName,
              selfKeyColumn,
              foreignKeyColumn,
            });
            continue;
          }

          if (linkField.hasOrderColumn()) {
            const orderColumn = yield* linkField.orderColumnName();
            const orderColumnExists = yield* await service.columnExists(
              context,
              resolvedSchema,
              resolvedTableName,
              orderColumn
            );
            if (!orderColumnExists) {
              service.logger.debug('computed:backfillMany:skip_missing_order_column', {
                tableId: input.table.id().toString(),
                fieldId: field.id().toString(),
                orderColumn,
              });
              continue;
            }
          }

          fields.push(field);
          continue;
        }

        if (relationship === 'manyOne' || relationship === 'oneOne') {
          const selfKeyColumn = yield* linkField.selfKeyNameString();
          const foreignKeyColumn = yield* linkField.foreignKeyNameString();
          const joinColumn =
            foreignKeyColumn !== '__id'
              ? foreignKeyColumn
              : selfKeyColumn !== '__id'
                ? selfKeyColumn
                : undefined;

          if (joinColumn) {
            const joinColumnExists = yield* await service.columnExists(
              context,
              resolvedSchema,
              resolvedTableName,
              joinColumn
            );
            if (!joinColumnExists) {
              service.logger.debug('computed:backfillMany:skip_missing_link_join_column', {
                tableId: input.table.id().toString(),
                fieldId: field.id().toString(),
                resolvedSchema,
                resolvedTableName,
                joinColumn,
                relationship,
              });
              continue;
            }
          }

          fields.push(field);
          continue;
        }

        const selfKeyColumn = yield* linkField.selfKeyNameString();
        if (selfKeyColumn !== '__id') {
          let selfKeyExistsResult = yield* await service.columnExists(
            context,
            resolvedSchema,
            resolvedTableName,
            selfKeyColumn
          );

          if (!selfKeyExistsResult && isTwoWayOneMany) {
            let oneManyForeignLocation = {
              schema: (linkField.baseId() ?? input.table.baseId()).toString(),
              tableName: linkField.foreignTableId().toString(),
            };

            const foreignTableSpec = TableByIdSpec.create(linkField.foreignTableId());
            const foreignTableResult = await service.tableRepository.findOne(
              context,
              foreignTableSpec
            );
            if (foreignTableResult.isOk()) {
              const dbTableNameResult = foreignTableResult.value
                .dbTableName()
                .andThen((name) => name.split({ defaultSchema: null }));
              if (dbTableNameResult.isOk()) {
                oneManyForeignLocation = {
                  schema: dbTableNameResult.value.schema ?? oneManyForeignLocation.schema,
                  tableName: dbTableNameResult.value.tableName,
                };
              }
            }

            const isFallbackDifferent =
              oneManyForeignLocation.schema !== resolvedSchema ||
              oneManyForeignLocation.tableName !== resolvedTableName;
            if (isFallbackDifferent) {
              const fallbackExistsResult = yield* await service.columnExists(
                context,
                oneManyForeignLocation.schema,
                oneManyForeignLocation.tableName,
                selfKeyColumn
              );
              if (fallbackExistsResult) {
                selfKeyExistsResult = true;
                resolvedSchema = oneManyForeignLocation.schema;
                resolvedTableName = oneManyForeignLocation.tableName;
              }
            }
          }

          if (!selfKeyExistsResult) {
            service.logger.debug('computed:backfillMany:skip_missing_self_key_column', {
              tableId: input.table.id().toString(),
              fieldId: field.id().toString(),
              selfKeyColumn,
            });
            continue;
          }
        }

        if (isTwoWayOneMany && linkField.hasOrderColumn()) {
          const orderColumn = yield* linkField.orderColumnName();
          const columnExistsResult = yield* await service.columnExists(
            context,
            resolvedSchema,
            resolvedTableName,
            orderColumn
          );
          if (!columnExistsResult) {
            service.logger.debug('computed:backfillMany:skip_missing_order_column', {
              tableId: input.table.id().toString(),
              fieldId: field.id().toString(),
              orderColumn,
            });
            continue;
          }
        }

        if (isTwoWayOneMany) {
          const foreignKeyColumn = yield* linkField.foreignKeyNameString();
          const foreignKeyExistsResult = yield* await service.columnExists(
            context,
            resolvedSchema,
            resolvedTableName,
            foreignKeyColumn
          );
          if (!foreignKeyExistsResult) {
            service.logger.debug('computed:backfillMany:skip_missing_foreign_key_column', {
              tableId: input.table.id().toString(),
              fieldId: field.id().toString(),
              resolvedSchema,
              resolvedTableName,
              foreignKeyColumn,
            });
            continue;
          }
        }

        fields.push(field);
      }

      return ok(fields);
    });
  }

  private async columnExists(
    context: IExecutionContext,
    schema: string | null,
    tableName: string,
    columnName: string
  ): Promise<Result<boolean, DomainError>> {
    const db = this.resolveDb(context);
    try {
      const schemaName = schema ?? 'public';
      const result = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = ${schemaName}
          AND table_name = ${tableName}
          AND column_name = ${columnName}
        ) as exists
      `.execute(db);
      return ok(result.rows[0]?.exists ?? false);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to check column existence for ${schema ?? 'public'}.${tableName}.${columnName}: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  /**
   * Determine if async mode should be used based on config and table size.
   */
  private async shouldUseAsyncMode(context: IExecutionContext, table: Table): Promise<boolean> {
    if (this.config.mode === 'sync') {
      return false;
    }

    if (this.config.mode === 'async') {
      return true;
    }

    const rowCountEstimate = await this.estimateTableRowCount(context, table);
    if (rowCountEstimate !== undefined) {
      return rowCountEstimate > this.config.hybridThreshold;
    }

    const fallbackToAsync = hasUnitOfWorkTransaction(context);
    this.logger.warn('computed:backfill:row_count_estimate_unavailable', {
      tableId: table.id().toString(),
      mode: this.config.mode,
      fallback: fallbackToAsync ? 'async' : 'sync',
      inTransaction: fallbackToAsync,
    });
    return fallbackToAsync;
  }

  private async estimateTableRowCount(
    context: IExecutionContext,
    table: Table
  ): Promise<number | undefined> {
    const locationResult = table
      .dbTableName()
      .andThen((dbTableName) => dbTableName.split({ defaultSchema: 'public' }));
    if (locationResult.isErr()) {
      this.logger.warn('computed:backfill:row_count_estimate_table_name_failed', {
        tableId: table.id().toString(),
        error: locationResult.error.message,
      });
      return undefined;
    }

    const db = this.resolveDb(context);
    const { schema, tableName } = locationResult.value;

    try {
      const result = await sql<{ estimated_row_count: number | string | null }>`
        SELECT GREATEST(c.reltuples, COALESCE(s.n_live_tup, 0), 0)::float8 AS estimated_row_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
        WHERE n.nspname = ${schema ?? 'public'}
          AND c.relname = ${tableName}
        LIMIT 1
      `.execute(db);

      const rawEstimate = result.rows[0]?.estimated_row_count;
      const estimate = rawEstimate == null ? undefined : Number(rawEstimate);
      return estimate !== undefined && Number.isFinite(estimate) ? Math.ceil(estimate) : undefined;
    } catch (error) {
      this.logger.warn('computed:backfill:row_count_estimate_failed', {
        tableId: table.id().toString(),
        tableSchema: schema ?? 'public',
        tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Resolve the database connection, using transaction if available.
   */
  private resolveDb(context: IExecutionContext): Kysely<DynamicDB> {
    const transaction = context.transaction as
      | { kind: 'unitOfWorkTransaction'; db: Transaction<DynamicDB> }
      | undefined;
    if (transaction?.kind === 'unitOfWorkTransaction' && transaction.db) {
      return transaction.db as unknown as Kysely<DynamicDB>;
    }
    return this.db as unknown as Kysely<DynamicDB>;
  }
}
