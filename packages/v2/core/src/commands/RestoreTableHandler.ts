import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  dispatchSameTxEvents,
  hasSameTxTargets,
  publishEventsWithBatchDeferral,
} from '../application/services/dispatchSameTxEvents';
import { NoopSameTxProjectionDispatcher } from '../application/services/SameTxProjectionDispatcher';
import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import type * as SameTxProjectionDispatcherPort from '../ports/SameTxProjectionDispatcher';
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
export class RestoreTableHandler implements ICommandHandler<
  RestoreTableCommand,
  RestoreTableResult
> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.sameTxProjectionDispatcher)
    private readonly sameTxProjectionDispatcher: SameTxProjectionDispatcherPort.ISameTxProjectionDispatcher = new NoopSameTxProjectionDispatcher()
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreTableCommand
  ): Promise<Result<RestoreTableResult, DomainError>> {
    const poisoned = ExecutionContextPort.getBatchRollbackError(context);
    if (poisoned) {
      return err(poisoned);
    }
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    const result = await safeTry<RestoreTableResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getDeletedByIdInBase(
        context,
        command.baseId,
        command.tableId
      );

      const events = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) =>
          safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
            yield* await handler.tableRepository.restore(transactionContext, table);
            yield* table.markRestored();
            const restoredEvents = table.pullDomainEvents();
            if (hasSameTxTargets(handler.sameTxProjectionDispatcher, restoredEvents)) {
              yield* await handler.unitOfWork.withTransaction(
                transactionContext,
                (dataTransactionContext) =>
                  dispatchSameTxEvents(
                    dataTransactionContext,
                    handler.sameTxProjectionDispatcher,
                    restoredEvents,
                    { tables: [table] }
                  ),
                { scope: 'data' }
              );
            }
            return ok(restoredEvents);
          }),
        { scope: 'meta' }
      );

      yield* await publishEventsWithBatchDeferral(context, handler.eventBus, events);

      return ok(RestoreTableResult.create(table, events));
    });
    return ExecutionContextPort.failBatchResultIfActive(context, result);
  }
}
