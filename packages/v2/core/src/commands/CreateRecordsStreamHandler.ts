import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { RecordValuesDTO } from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import { calculateBatchSize } from '../domain/table/methods/records/calculateBatchSize';
import type { TableRecord } from '../domain/table/records/TableRecord';
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
export class CreateRecordsStreamHandler
  implements ICommandHandler<CreateRecordsStreamCommand, CreateRecordsStreamResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
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
    const handler = this;
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

      // 2. Use streaming generator to create records in batches
      const batchGenerator = table.createRecordsStream(recordsFieldValues, {
        batchSize: command.batchSize,
      });

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
              handler.consumeBatches(batchGenerator, (batch) => {
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
              })
            );
            return ok(domainWrite.fromEvents(insertResult, events, { tables: [table] }));
          });
        }
      );

      await pluginExecution.afterCommit();

      return ok(CreateRecordsStreamResult.create(committed.value.totalInserted, committed.events));
    });
  }

  /**
   * Consume the batch generator, unwrapping Results and yielding raw batches.
   * Throws on first error encountered.
   */
  private *consumeBatches(
    generator: Generator<Result<ReadonlyArray<TableRecord>, DomainError>>,
    onBatch?: (batch: ReadonlyArray<TableRecord>) => void
  ): Generator<ReadonlyArray<TableRecord>> {
    for (const batchResult of generator) {
      if (batchResult.isErr()) {
        throw batchResult.error;
      }
      onBatch?.(batchResult.value);
      yield batchResult.value;
    }
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
