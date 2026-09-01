import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import type { RecordWritePluginExecution } from '../application/services/RecordWritePluginRunner';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { tableDataSafetyLimitErrors } from '../domain/shared/TableDataSafetyLimits';
import type { RecordValuesDTO } from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import type { Table } from '../domain/table/Table';
import type { TableId } from '../domain/table/TableId';
import * as EventBusPort from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { IImportParseResult, SourceColumnMap } from '../ports/import/IImportSource';
import * as IImportSourceRegistryPort from '../ports/import/IImportSourceRegistry';
import {
  RecordWriteOperationKind,
  type RecordWriteFieldValues,
  type RecordWriteImportAppendPayload,
  type RecordWritePluginOrchestration,
} from '../ports/RecordWritePlugin';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ImportRecordsCommand } from './ImportRecordsCommand';
import { toAsyncIterable } from './shared/toAsyncIterable';

/**
 * Result of ImportRecordsCommand execution.
 */
export class ImportRecordsResult {
  private constructor(
    readonly totalImported: number,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(totalImported: number, events: ReadonlyArray<IDomainEvent>): ImportRecordsResult {
    return new ImportRecordsResult(totalImported, [...events]);
  }
}

/**
 * Internal state for streaming import processing.
 * Passed through the generator to maintain state across batches.
 */
interface ImportStreamState {
  table: Table;
  events: IDomainEvent[];
  currentBatch: number;
  operationId: string;
  totalRecordCount: number;
  totalChunkCount: number;
  sourceType: string;
  sourceColumnMap: SourceColumnMap;
  maxRowCount?: number;
  previousPluginExecution: RecordWritePluginExecution;
}

/**
 * Handler for ImportRecordsCommand.
 *
 * Implements streaming import (append records to existing table):
 * 1. Find table by ID
 * 2. Parse import source via adapter (streaming)
 * 3. Validate column mapping
 * 4. Stream process batches via async generator:
 *    - Handle side effects (create new select options as discovered)
 *    - Create records with typecast
 *    - Resolve link fields
 *    - Yield batch for insertion
 * 5. Insert via insertManyStream
 */
@CommandHandler(ImportRecordsCommand)
@injectable()
export class ImportRecordsHandler
  implements ICommandHandler<ImportRecordsCommand, ImportRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.importSourceRegistry)
    private readonly registry: IImportSourceRegistryPort.IImportSourceRegistry,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.recordMutationSpecResolverService)
    private readonly recordMutationSpecResolver: RecordMutationSpecResolverService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async handle(
    context: IExecutionContext,
    command: ImportRecordsCommand
  ): Promise<Result<ImportRecordsResult, DomainError>> {
    const handler = this;
    const { tableId, source, sourceColumnMap, options } = command;
    const skipFirstNLines = options.skipFirstNLines ?? 0;
    const typecast = options.typecast ?? true;
    const onProgress = options.onProgress;
    const batchSize = options.batchSize ?? 500;
    const maxRowCount = options.maxRowCount;

    return safeTry<ImportRecordsResult, DomainError>(async function* () {
      // 1. Find table
      const tableSpec = TableByIdSpec.create(tableId);
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);

      // 2. Get adapter for source type
      const adapter = yield* handler.registry.getAdapter(source.type);

      // 3. Parse source (streaming)
      onProgress?.({ phase: 'parsing', processedRows: 0, currentBatch: 0 });
      const parseResult = yield* await adapter.parse(source, options);
      onProgress?.({
        phase: 'parsing',
        processedRows: 0,
        currentBatch: 0,
        totalRows:
          parseResult.rowCount != null
            ? Math.max(parseResult.rowCount - skipFirstNLines, 0)
            : undefined,
      });

      // 4. Validate column mapping
      yield* handler.validateColumnMapping(table, sourceColumnMap, parseResult.headers);
      const knownDataRowCount = handler.resolveKnownDataRowCount(parseResult, skipFirstNLines);
      const operationId = `import-records:${tableId.toString()}`;
      const totalRecordCount = knownDataRowCount ?? 0;
      const totalChunkCount =
        knownDataRowCount != null ? Math.ceil(knownDataRowCount / batchSize) : 0;
      onProgress?.({
        phase: 'inserting',
        processedRows: 0,
        currentBatch: 0,
        totalRows: knownDataRowCount,
      });
      const operationPluginExecution = yield* await handler.preparePluginExecution(
        context,
        table,
        {
          sourceType: source.type,
          sourceColumnMap,
          recordsFieldValues: [],
          batchSize,
          typecast,
          recordCount: totalRecordCount,
          maxRowCount,
        },
        {
          mode: 'stream',
          scope: 'operation',
          operationId,
          totalRecordCount,
          totalChunkCount,
        },
        false
      );

      // 5. Create streaming state
      const state: ImportStreamState = {
        table,
        events: [],
        currentBatch: 0,
        operationId,
        totalRecordCount,
        totalChunkCount,
        sourceType: source.type,
        sourceColumnMap,
        maxRowCount,
        previousPluginExecution: operationPluginExecution,
      };

      // 6. Stream insert via insertManyStream.
      // Row batches stay an AsyncIterable: parse → field values → records → insert.
      const insertResult: TableRecordRepositoryPort.InsertManyStreamResult =
        yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) => {
          try {
            const recordBatches = handler.createRecordBatchesStream(
              transactionContext,
              state,
              handler.createFieldValueBatches(
                parseResult,
                sourceColumnMap,
                skipFirstNLines,
                batchSize,
                maxRowCount
              ),
              typecast
            );
            return await handler.tableRecordRepository.insertManyStream(
              transactionContext,
              state.table,
              recordBatches,
              {
                deferComputedUpdates: true,
                enqueueDeferredComputedUpdates: true,
                onBatchInserted: (progress) => {
                  onProgress?.({
                    phase: 'inserting',
                    processedRows: progress.totalInserted,
                    currentBatch: state.currentBatch,
                    totalRows: knownDataRowCount ?? progress.totalInserted,
                  });
                },
              }
            );
          } catch (error) {
            if (isDomainError(error)) {
              return err(error);
            }
            return err(
              domainError.fromUnknown(error, {
                code: 'import.insert_stream_failed',
              })
            );
          }
        });

      // 8. Publish all collected events
      if (state.events.length > 0) {
        yield* await handler.eventBus.publishMany(context, state.events);
      }

      onProgress?.({
        phase: 'completed',
        processedRows: insertResult.totalInserted,
        currentBatch: state.currentBatch,
        totalRows: insertResult.totalInserted,
      });
      await state.previousPluginExecution.afterCommit();

      return ok(ImportRecordsResult.create(insertResult.totalInserted, state.events));
    });
  }

  private async preparePluginExecution(
    context: IExecutionContext,
    table: Table,
    payload: RecordWriteImportAppendPayload,
    orchestration: RecordWritePluginOrchestration,
    isTransactionBound: boolean,
    previousExecution?: RecordWritePluginExecution
  ): Promise<Result<RecordWritePluginExecution, DomainError>> {
    const pluginExecutionResult = await this.recordWritePluginRunner.prepare(
      {
        kind: RecordWriteOperationKind.importAppend,
        executionContext: context,
        table,
        payload,
        orchestration,
        isTransactionBound,
      },
      previousExecution ? { previousExecution } : undefined
    );
    if (pluginExecutionResult.isErr()) {
      return err(pluginExecutionResult.error);
    }

    const guardResult = await pluginExecutionResult.value.guard();
    if (guardResult.isErr()) {
      return err(guardResult.error);
    }

    return ok(pluginExecutionResult.value);
  }

  /**
   * Create async generator that yields processed record batches.
   * Each batch goes through: side effects → create records → resolve links.
   */
  private async *createRecordBatchesStream(
    context: IExecutionContext,
    state: ImportStreamState,
    fieldValueBatches: AsyncIterable<ReadonlyArray<RecordWriteFieldValues>>,
    typecast: boolean
  ): AsyncGenerator<ReadonlyArray<TableRecord>> {
    for await (const batchFieldValues of fieldValueBatches) {
      const chunkIndex = state.currentBatch;
      state.currentBatch++;

      if (batchFieldValues.length === 0) continue;

      const pluginExecutionResult = await this.preparePluginExecution(
        context,
        state.table,
        {
          sourceType: state.sourceType,
          sourceColumnMap: state.sourceColumnMap,
          recordsFieldValues: batchFieldValues,
          batchSize: batchFieldValues.length,
          typecast,
          recordCount: batchFieldValues.length,
          maxRowCount: state.maxRowCount,
        },
        {
          mode: 'stream',
          scope: 'chunk',
          operationId: state.operationId,
          totalRecordCount: state.totalRecordCount,
          totalChunkCount: state.totalChunkCount,
          chunkIndex,
        },
        true,
        state.previousPluginExecution
      );
      if (pluginExecutionResult.isErr()) {
        throw pluginExecutionResult.error;
      }
      const pluginExecution = pluginExecutionResult.value;
      state.previousPluginExecution = pluginExecution;

      // Handle side effects for this batch (discover new select options)
      if (typecast) {
        const sideEffectResult = this.recordWriteSideEffectService.execute(
          context,
          state.table,
          batchFieldValues,
          typecast
        );
        if (sideEffectResult.isErr()) {
          throw new Error(sideEffectResult.error.message);
        }
        state.table = sideEffectResult.value.table;

        // If new options discovered, persist them
        if (sideEffectResult.value.updateResult) {
          const updateResult = await this.tableUpdateFlow.execute(
            context,
            { table: state.table },
            () => ok(sideEffectResult.value.updateResult!),
            { publishEvents: false }
          );
          if (updateResult.isErr()) {
            throw new Error(updateResult.error.message);
          }
          state.table = updateResult.value.table;
          state.events.push(...(updateResult.value.events ?? []));
        }
      }

      // Create records for this batch (with typecast)
      const createResult = state.table.createRecords(batchFieldValues, { typecast });
      if (createResult.isErr()) {
        throw new Error(createResult.error.message);
      }

      let records = [...createResult.value.records];

      // Resolve link fields for this batch if typecast enabled
      if (typecast && createResult.value.mutateSpecs) {
        records = await this.resolveRecordLinks(
          context,
          state.table.id(),
          records,
          createResult.value.mutateSpecs
        );
      }

      // Emit a RecordsBatchCreated event so projection handlers (audit log,
      // realtime, automation) see the imported batch. Without this, the records
      // are inserted via insertManyStream but no domain event ever fires.
      const eventRecords = this.toEventRecords(records);
      if (eventRecords.length > 0) {
        state.events.push(
          RecordsBatchCreated.create({
            tableId: state.table.id(),
            baseId: state.table.baseId(),
            records: eventRecords,
            source: { type: 'import' },
            orchestration: {
              operationId: state.operationId,
              totalRecordCount: state.totalRecordCount,
              totalChunkCount: state.totalChunkCount,
              chunkIndex,
              scope: 'chunk',
            },
          })
        );
      }

      const beforePersistResult = await pluginExecution.beforePersist(context);
      if (beforePersistResult.isErr()) {
        throw beforePersistResult.error;
      }

      // Yield processed batch for insertion
      yield records;
    }
  }

  private toEventRecords(records: ReadonlyArray<TableRecord>): ReadonlyArray<RecordValuesDTO> {
    return records.map((record) => ({
      recordId: record.id().toString(),
      fields: record
        .fields()
        .entries()
        .map((entry) => ({
          fieldId: entry.fieldId.toString(),
          value: entry.value.toValue(),
        })),
    }));
  }

  private async *createFieldValueBatches(
    parseResult: IImportParseResult,
    sourceColumnMap: SourceColumnMap,
    skipFirstNLines: number,
    batchSize: number,
    maxRowCount?: number
  ): AsyncIterable<ReadonlyArray<RecordWriteFieldValues>> {
    for await (const rowBatch of this.createRowBatches(
      parseResult,
      skipFirstNLines,
      batchSize,
      maxRowCount
    )) {
      yield rowBatch.map((row) => this.rowToFieldValues(row, sourceColumnMap));
    }
  }

  /**
   * Create async generator that yields batches of rows from parse result.
   */
  private async *createRowBatches(
    parseResult: IImportParseResult,
    skipFirstNLines: number,
    batchSize: number,
    maxRowCount?: number
  ): AsyncGenerator<ReadonlyArray<unknown>[]> {
    let batch: ReadonlyArray<unknown>[] = [];
    let rowIndex = 0;
    let processedRows = 0;

    const rows = parseResult.rowsAsync ?? toAsyncIterable(parseResult.rows ?? []);
    for await (const row of rows) {
      rowIndex++;
      if (rowIndex <= skipFirstNLines) continue;
      if (maxRowCount !== undefined && processedRows >= maxRowCount) {
        throw domainError.validation({
          code: tableDataSafetyLimitErrors.rowsPerTableMax.code,
          message: `Exceed max row limit: ${maxRowCount}`,
          details: {
            max: maxRowCount,
            maxRowCount,
            rowCount: processedRows + 1,
          },
          localization: {
            i18nKey: tableDataSafetyLimitErrors.rowsPerTableMax.i18nKey,
            context: { max: maxRowCount },
          },
        });
      }
      processedRows++;
      batch.push(row);
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }

    if (batch.length > 0) {
      yield batch;
    }
  }

  private resolveKnownDataRowCount(
    parseResult: IImportParseResult,
    skipFirstNLines: number
  ): number | undefined {
    if (parseResult.rowCount != null) {
      return Math.max(parseResult.rowCount - skipFirstNLines, 0);
    }
    if (!parseResult.rowsAsync && Array.isArray(parseResult.rows)) {
      return Math.max(parseResult.rows.length - skipFirstNLines, 0);
    }
    return undefined;
  }

  /**
   * Resolve link/user/attachment fields for records that need resolution.
   * Uses batch resolution to avoid N+1 queries.
   */
  private async resolveRecordLinks(
    context: IExecutionContext,
    tableId: TableId,
    records: TableRecord[],
    mutateSpecs: ReadonlyArray<ICellValueSpec | null>
  ): Promise<TableRecord[]> {
    // Filter specs that need resolution
    const specsNeedingResolution: (ICellValueSpec | null)[] = [];
    const needsResolutionFlags: boolean[] = [];

    for (const mutateSpec of mutateSpecs) {
      if (mutateSpec) {
        const needsResolution = this.recordMutationSpecResolver.needsResolution(mutateSpec);
        if (needsResolution.isOk() && needsResolution.value) {
          specsNeedingResolution.push(mutateSpec);
          needsResolutionFlags.push(true);
          continue;
        }
      }
      specsNeedingResolution.push(null);
      needsResolutionFlags.push(false);
    }

    // Check if any specs need resolution
    const hasAnyResolution = needsResolutionFlags.some((flag) => flag);
    if (!hasAnyResolution) {
      return records;
    }

    // Batch resolve ALL specs at once (single query per resolver type)
    const resolveResult = await this.recordMutationSpecResolver.resolveAndReplaceMany(
      context,
      tableId,
      specsNeedingResolution
    );

    if (resolveResult.isErr()) {
      throw new Error(resolveResult.error.message);
    }

    const resolvedSpecs = resolveResult.value;

    // Apply resolved specs to records
    const resolvedRecords: TableRecord[] = [];
    for (let i = 0; i < records.length; i++) {
      let record = records[i]!;
      const resolvedSpec = resolvedSpecs[i];

      if (resolvedSpec) {
        const mutateResult = resolvedSpec.mutate(record);
        if (mutateResult.isOk()) {
          record = mutateResult.value;
        }
      }
      resolvedRecords.push(record);
    }

    return resolvedRecords;
  }

  private validateColumnMapping(
    table: Table,
    sourceColumnMap: SourceColumnMap,
    headers: ReadonlyArray<string>
  ): Result<void, DomainError> {
    const fields = table.getFields();
    const fieldIds = new Set(fields.map((f) => f.id().toString()));

    for (const [fieldId, columnIndex] of Object.entries(sourceColumnMap)) {
      if (!fieldIds.has(fieldId)) {
        return err(
          domainError.validation({
            message: `Field ${fieldId} not found in table`,
            code: 'import.field_not_found',
          })
        );
      }
      if (columnIndex !== null && columnIndex >= headers.length) {
        return err(
          domainError.validation({
            message: `Column index ${columnIndex} out of range (headers length: ${headers.length})`,
            code: 'import.column_index_out_of_range',
          })
        );
      }
    }
    return ok(undefined);
  }

  private rowToFieldValues(
    row: ReadonlyArray<unknown>,
    sourceColumnMap: SourceColumnMap
  ): ReadonlyMap<string, unknown> {
    const fieldValues = new Map<string, unknown>();
    for (const [fieldId, columnIndex] of Object.entries(sourceColumnMap)) {
      if (columnIndex === null || columnIndex >= row.length) continue;

      const value = row[columnIndex];
      if (value === null || value === undefined) continue;
      if (typeof value === 'string' && value.length === 0) continue;

      fieldValues.set(fieldId, value);
    }
    return fieldValues;
  }
}
