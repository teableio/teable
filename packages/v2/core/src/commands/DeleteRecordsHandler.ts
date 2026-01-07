import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import { isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteRecordsCommand } from './DeleteRecordsCommand';

export class DeleteRecordsResult {
  private constructor(
    readonly deletedRecordIds: ReadonlyArray<string>,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(deletedRecordIds: ReadonlyArray<string>, events: ReadonlyArray<IDomainEvent>) {
    return new DeleteRecordsResult([...deletedRecordIds], [...events]);
  }
}

@CommandHandler(DeleteRecordsCommand)
@injectable()
export class DeleteRecordsHandler
  implements ICommandHandler<DeleteRecordsCommand, DeleteRecordsResult>
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
    command: DeleteRecordsCommand
  ): Promise<Result<DeleteRecordsResult, DomainError>> {
    const handler = this;
    return safeTry<DeleteRecordsResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      const specBuilder = TableRecord.specs('or');
      for (const recordId of command.recordIds) {
        specBuilder.recordId(recordId);
      }
      const deleteSpec = yield* specBuilder.build();

      yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) => {
        const deleteResult = await handler.tableRecordRepository.deleteMany(
          transactionContext,
          table,
          deleteSpec
        );

        if (deleteResult.isErr()) {
          if (isNotFoundError(deleteResult.error)) return ok(undefined);
          return err(deleteResult.error);
        }

        return ok(undefined);
      });

      const events: IDomainEvent[] = [];
      yield* await handler.eventBus.publishMany(context, events);

      return ok(
        DeleteRecordsResult.create(
          command.recordIds.map((id) => id.toString()),
          events
        )
      );
    });
  }
}
