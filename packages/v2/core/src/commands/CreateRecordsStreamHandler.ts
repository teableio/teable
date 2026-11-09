import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { RecordValuesDTO } from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import { calculateBatchSize } from '../domain/table/methods/records/calculateBatchSize';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import { domainWrite, type IDomainWriteTransaction } from '../ports/DomainWriteTransaction';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateRecordsStreamCommand } from './CreateRecordsStreamCommand';

export class CreateRecordsStreamResult {
  private constructor(
    readonly totalCreated: number,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    totalCreated: number,
    events: ReadonlyArray<IDomainEvent>
  ): CreateRecordsStreamResult {
    return new CreateRecordsStreamResult(totalCreated, [...events]);
  }
}

@CommandHandler(CreateRecordsStreamCommand)
@injectable()
export class CreateRecordsStreamHandler implements ICommandHandler<
  CreateRecordsStreamCommand,
  CreateRecordsStreamResult
> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordMutationSpecResolverService)
    private readonly recordMutationSpecResolver: RecordMutationSpecResolverService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.domainWriteTransaction)
    private readonly domainWriteTransaction: IDomainWriteTransaction
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateRecordsStreamCommand
  ): Promise<Result<CreateRecordsStreamResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<CreateRecordsStreamResult, DomainError>(async function* () {
      // 1. Get the table
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      const recordsFieldValues = [...command.recordsFieldValues];
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.createStream,
        executionContext: context,
        table,
        payload: {
          recordsFieldValues,
          batchSize: command.batchSize,
          recordCount: recordsFieldValues.length,
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      // 2. Create and resolve one bounded record batch at a time.
      const committed = yield* await handler.domainWriteTransaction.execute(
        context,
        async (transactionContext) => {
          return safeTry(async function* () {
            yield* await pluginExecution.beforePersist(transactionContext);
            const events: IDomainEvent[] = [];
            const totalRecordCount = recordsFieldValues.length;
            const effectiveBatchSize = calculateBatchSize(
              table.getFields().length,
              command.batchSize
            );
            const totalChunkCount = Math.max(
              1,
              Math.ceil(totalRecordCount / Math.max(effectiveBatchSize, 1))
            );
            let chunkIndex = 0;
            const insertResult = yield* await handler.tableRecordRepository.insertManyStream(
              transactionContext,
              table,
              handler.createBatches(
                transactionContext,
                table,
                recordsFieldValues,
                effectiveBatchSize,
                (batch) => {
                  const eventRecords = toStreamCreatedEventRecords(batch);
                  if (eventRecords.length > 0) {
                    events.push(
                      RecordsBatchCreated.create({
                        tableId: table.id(),
                        baseId: table.baseId(),
                        records: eventRecords,
                        orchestration: {
                          totalRecordCount,
                          totalChunkCount,
                          chunkIndex: chunkIndex++,
                          scope: 'chunk',
                        },
                      })
                    );
                  }
                }
              )
            );
            return ok(domainWrite.fromEvents(insertResult, events, { tables: [table] }));
          });
        }
      );

      await pluginExecution.afterCommit();

      return ok(CreateRecordsStreamResult.create(committed.value.totalInserted, committed.events));
    });
  }

  private async *createBatches(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    recordsFieldValues: Iterable<ReadonlyMap<string, unknown>>,
    batchSize: number,
    onBatch: (batch: ReadonlyArray<TableRecord>) => void
  ): AsyncGenerator<ReadonlyArray<TableRecord>> {
    let fieldValuesBatch: ReadonlyMap<string, unknown>[] = [];

    for (const fieldValues of recordsFieldValues) {
      fieldValuesBatch.push(fieldValues);
      if (fieldValuesBatch.length < batchSize) continue;

      const records = await this.createBatch(context, table, fieldValuesBatch);
      onBatch(records);
      yield records;
      fieldValuesBatch = [];
    }

    if (fieldValuesBatch.length > 0) {
      const records = await this.createBatch(context, table, fieldValuesBatch);
      onBatch(records);
      yield records;
    }
  }

  private async createBatch(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    fieldValuesBatch: ReadonlyArray<ReadonlyMap<string, unknown>>
  ): Promise<ReadonlyArray<TableRecord>> {
    const createResult = table.createRecords(fieldValuesBatch);
    if (createResult.isErr()) throw createResult.error;

    const resolveResult = await this.recordMutationSpecResolver.resolveCreatedRecords(
      context,
      table.id(),
      createResult.value
    );
    if (resolveResult.isErr()) throw resolveResult.error;

    return resolveResult.value.records;
  }
}

function toStreamCreatedEventRecords(
  records: ReadonlyArray<TableRecord>
): ReadonlyArray<RecordValuesDTO> {
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
