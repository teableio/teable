import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type {
  IImportParseResult,
  IImportProgress,
  SourceColumnMap,
} from '../ports/import/IImportSource';
import * as IImportSourceRegistryPort from '../ports/import/IImportSourceRegistry';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ImportRecordsCommand } from './ImportRecordsCommand';

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
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus
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

      // 4. Validate column mapping
      yield* handler.validateColumnMapping(table, sourceColumnMap, parseResult.headers);

      // 5. Create streaming state
      const state: ImportStreamState = {
        table,
        events: [],
        currentBatch: 0,
      };

      // 6. Create async generator that processes and yields record batches
      const recordBatches = handler.createRecordBatchesStream(
        context,
        state,
        parseResult,
        sourceColumnMap,
        skipFirstNLines,
        batchSize,
        typecast,
        onProgress,
        maxRowCount
      );

      // 7. Stream insert via insertManyStream
      // Use deferComputedUpdates to avoid blocking the response while computed fields update
      let insertResult: TableRecordRepositoryPort.InsertManyStreamResult;
      try {
        insertResult = yield* await handler.tableRecordRepository.insertManyStream(
          context,
          state.table,
          recordBatches,
          {
            deferComputedUpdates: true,
            onBatchInserted: (progress) => {
              onProgress?.({
                phase: 'inserting',
                processedRows: progress.totalInserted,
                currentBatch: state.currentBatch,
              });
            },
          }
        );
      } catch (error) {
        if (error instanceof MaxRowCountExceededError) {
          return err(
            domainError.validation({
              code: 'validation.max_row_limit',
              message: `Exceed max row limit: ${error.maxRowCount}`,
              details: {
                maxRowCount: error.maxRowCount,
                rowCount: error.rowCount,
              },
            })
          );
        }
        throw error;
      }

      // 8. Publish all collected events
      if (state.events.length > 0) {
        yield* await handler.eventBus.publishMany(context, state.events);
      }

      onProgress?.({
        phase: 'completed',
        processedRows: insertResult.totalInserted,
        currentBatch: state.currentBatch,
      });

      return ok(ImportRecordsResult.create(insertResult.totalInserted, state.events));
    });
  }

  /**
   * Create async generator that yields processed record batches.
   * Each batch goes through: side effects → create records → resolve links.
   */
  private async *createRecordBatchesStream(
    context: IExecutionContext,
    state: ImportStreamState,
    parseResult: IImportParseResult,
    sourceColumnMap: SourceColumnMap,
    skipFirstNLines: number,
    batchSize: number,
    typecast: boolean,
    onProgress?: (progress: IImportProgress) => void,
    maxRowCount?: number
  ): AsyncGenerator<ReadonlyArray<TableRecord>> {
    // Create row batches from parse result
    const rowBatches = this.createRowBatches(parseResult, skipFirstNLines, batchSize, maxRowCount);

    for await (const rowBatch of rowBatches) {
      state.currentBatch++;
      onProgress?.({ phase: 'inserting', processedRows: 0, currentBatch: state.currentBatch });

      // Convert rows to field values
      const batchFieldValues = rowBatch.map((row) => this.rowToFieldValues(row, sourceColumnMap));

      if (batchFieldValues.length === 0) continue;

      // Handle side effects for this batch (discover new select options)
      if (typecast) {
        const sideEffectResult = this.recordWriteSideEffectService.execute(
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
        records = await this.resolveRecordLinks(context, records, createResult.value.mutateSpecs);
      }

      // Yield processed batch for insertion
      yield records;
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
    let exceeded = false;
    let exceededAt = 0;

    const processRow = (row: ReadonlyArray<unknown>) => {
      rowIndex++;
      if (rowIndex <= skipFirstNLines) return;
      if (maxRowCount !== undefined && processedRows >= maxRowCount) {
        exceeded = true;
        exceededAt = processedRows + 1;
        return false;
      }
      processedRows++;
      batch.push(row);
      return true;
    };

    if (parseResult.rowsAsync) {
      for await (const row of parseResult.rowsAsync) {
        const accepted = processRow(row);
        if (accepted === false) break;
        if (batch.length >= batchSize) {
          yield batch;
          batch = [];
        }
      }
    } else if (parseResult.rows) {
      for (const row of parseResult.rows) {
        const accepted = processRow(row);
        if (accepted === false) break;
        if (batch.length >= batchSize) {
          yield batch;
          batch = [];
        }
      }
    }

    // Yield remaining rows
    if (batch.length > 0) {
      yield batch;
    }

    if (exceeded) {
      throw new MaxRowCountExceededError(maxRowCount ?? 0, exceededAt);
    }
  }

  /**
   * Resolve link/user/attachment fields for records that need resolution.
   * Uses batch resolution to avoid N+1 queries.
   */
  private async resolveRecordLinks(
    context: IExecutionContext,
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

class MaxRowCountExceededError extends Error {
  constructor(
    readonly maxRowCount: number,
    readonly rowCount: number
  ) {
    super(`Exceed max row limit: ${maxRowCount}`);
    this.name = 'MaxRowCountExceededError';
  }
}
