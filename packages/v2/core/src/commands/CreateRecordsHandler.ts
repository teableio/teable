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
import { CreateRecordsCommand } from './CreateRecordsCommand';

export class CreateRecordsResult {
  private constructor(
    readonly records: ReadonlyArray<TableRecord>,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    records: ReadonlyArray<TableRecord>,
    events: ReadonlyArray<IDomainEvent>
  ): CreateRecordsResult {
    return new CreateRecordsResult([...records], [...events]);
  }
}

@CommandHandler(CreateRecordsCommand)
@injectable()
export class CreateRecordsHandler
  implements ICommandHandler<CreateRecordsCommand, CreateRecordsResult>
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
    command: CreateRecordsCommand
  ): Promise<Result<CreateRecordsResult, DomainError>> {
    const handler = this;
    return safeTry<CreateRecordsResult, DomainError>(async function* () {
      // 1. Get the table
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // 2. Create all records (validates and applies field values internally)
      const records = yield* table.createRecords(command.recordsFieldValues);

      // 3. Persist all records within a transaction
      yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) => {
        return safeTry<void, DomainError>(async function* () {
          yield* await handler.tableRecordRepository.insertMany(transactionContext, table, records);
          return ok(undefined);
        });
      });

      // 4. Publish events (if any) - only after transaction succeeds
      const events: IDomainEvent[] = [];
      yield* await handler.eventBus.publishMany(context, events);

      return ok(CreateRecordsResult.create(records, events));
    });
  }
}
