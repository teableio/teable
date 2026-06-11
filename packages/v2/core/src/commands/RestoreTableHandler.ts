import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RestoreTableCommand } from './RestoreTableCommand';

export class RestoreTableResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): RestoreTableResult {
    return new RestoreTableResult(table, [...events]);
  }
}

@CommandHandler(RestoreTableCommand)
@injectable()
export class RestoreTableHandler
  implements ICommandHandler<RestoreTableCommand, RestoreTableResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreTableCommand
  ): Promise<Result<RestoreTableResult, DomainError>> {
    const handler = this;
    return safeTry<RestoreTableResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getDeletedByIdInBase(
        context,
        command.baseId,
        command.tableId
      );

      yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => handler.tableRepository.restore(transactionContext, table),
        { scope: 'meta' }
      );

      yield* table.markRestored();
      const events = table.pullDomainEvents();
      yield* await handler.eventBus.publishMany(context, events);

      return ok(RestoreTableResult.create(table, events));
    });
  }
}
