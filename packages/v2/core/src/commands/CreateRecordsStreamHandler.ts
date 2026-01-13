import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
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
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
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

      // 2. Use streaming generator to create records in batches
      const batchGenerator = table.createRecordsStream(command.recordsFieldValues, {
        batchSize: command.batchSize,
      });

      // 3. Consume generator and persist batches within a transaction
      const insertResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return handler.tableRecordRepository.insertManyStream(
            transactionContext,
            table,
            handler.consumeBatches(batchGenerator)
          );
        }
      );

      // 4. Publish events (if any) - only after transaction succeeds
      const events: IDomainEvent[] = [];
      yield* await handler.eventBus.publishMany(context, events);

      return ok(CreateRecordsStreamResult.create(insertResult.totalInserted, events));
    });
  }

  /**
   * Consume the batch generator, unwrapping Results and yielding raw batches.
   * Throws on first error encountered.
   */
  private *consumeBatches(
    generator: Generator<Result<ReadonlyArray<TableRecord>, DomainError>>
  ): Generator<ReadonlyArray<TableRecord>> {
    for (const batchResult of generator) {
      if (batchResult.isErr()) {
        // Convert error to exception for the transaction to catch
        throw batchResult.error;
      }
      yield batchResult.value;
    }
  }
}
