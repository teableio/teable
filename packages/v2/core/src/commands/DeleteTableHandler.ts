import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableDeletionSideEffectService } from '../application/services/TableDeletionSideEffectService';
import {
  beginTableSchemaOperation,
  completeTableSchemaOperation,
  failRecoverableTableSchemaOperation,
  failTableSchemaOperation,
} from '../application/services/TableSchemaOperationLifecycleService';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRepositoryPort from '../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteTableCommand } from './DeleteTableCommand';

export class DeleteTableResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): DeleteTableResult {
    return new DeleteTableResult(table, [...events]);
  }
}

@CommandHandler(DeleteTableCommand)
@injectable()
export class DeleteTableHandler implements ICommandHandler<DeleteTableCommand, DeleteTableResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.tableDeletionSideEffectService)
    private readonly tableDeletionSideEffectService: TableDeletionSideEffectService,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteTableCommand
  ): Promise<Result<DeleteTableResult, DomainError>> {
    const logger = this.logger.scope('command', { name: DeleteTableHandler.name }).child({
      baseId: command.baseId.toString(),
      tableId: command.tableId.toString(),
      mode: command.mode,
    });
    logger.debug('DeleteTableHandler.start', {
      actorId: context.actorId.toString(),
    });

    const tableRepository = this.tableRepository;
    const tableSchemaRepository = this.tableSchemaRepository;
    const tableDeletionSideEffectService = this.tableDeletionSideEffectService;
    const unitOfWork = this.unitOfWork;
    const eventBus = this.eventBus;
    const result = await safeTry<DeleteTableResult, DomainError>(async function* () {
      const specResult = yield* TableAggregate.specs(command.baseId).byId(command.tableId).build();
      const activeTableResult = await tableRepository.findOne(context, specResult, {
        state: 'activeAnyProvision',
      });
      let tableResult = activeTableResult;
      // Match v1: convert inbound link fields to text as soon as the table is
      // trashed. Waiting until permanent delete leaves broken link cells that
      // freeze the record editor until the trash is emptied.
      let shouldRunSideEffects = activeTableResult.isOk();

      if (
        command.mode === 'permanent' &&
        activeTableResult.isErr() &&
        isNotFoundError(activeTableResult.error)
      ) {
        tableResult = await tableRepository.findOne(context, specResult, { state: 'all' });
        shouldRunSideEffects = true;
      }

      if (tableResult.isErr()) {
        if (isNotFoundError(tableResult.error)) {
          return err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
        }
        return err(tableResult.error);
      }
      const table = tableResult.value;
      const sideEffectEvents: IDomainEvent[] = [];
      const sideEffectPostPersistEvents: IDomainEvent[] = [];
      yield* await beginTableSchemaOperation(unitOfWork, tableRepository, context, table, {
        type: 'table.delete',
        phase: 'deleting',
        state: 'deleting',
        payload: { mode: command.mode },
      });

      let dataPhaseCompleted = false;
      const deleteResult = await unitOfWork.withTransaction(
        context,
        async (metaTransactionContext) =>
          safeTry<void, DomainError>(async function* () {
            yield* await unitOfWork.withTransaction(
              metaTransactionContext,
              async (dataTransactionContext) =>
                safeTry<void, DomainError>(async function* () {
                  if (shouldRunSideEffects) {
                    const sideEffectResult = yield* await tableDeletionSideEffectService.execute(
                      dataTransactionContext,
                      { table }
                    );
                    sideEffectEvents.push(...sideEffectResult.events);
                    sideEffectPostPersistEvents.push(...sideEffectResult.postPersistEvents);
                  }
                  yield* await tableSchemaRepository.delete(dataTransactionContext, table, {
                    mode: command.mode,
                  });
                  // Stage the target metadata delete before an independent data transaction may
                  // commit. Same-database adapters share one transaction; split adapters return a
                  // metadata SQL failure while the relation conversion can still roll back.
                  yield* await tableRepository.delete(metaTransactionContext, table, {
                    mode: command.mode,
                  });
                  return ok(undefined);
                }),
              { scope: 'data', retry: false }
            );
            dataPhaseCompleted = true;
            return ok(undefined);
          }),
        { scope: 'meta', retry: false }
      );
      if (deleteResult.isErr()) {
        // A failure before the data transaction commits rolls both scopes back. Once a split data
        // transaction succeeds, do not replay it through the outer metadata transaction retry loop.
        const failResult = !dataPhaseCompleted
          ? await failRecoverableTableSchemaOperation(unitOfWork, tableRepository, context, table, {
              type: 'table.delete',
              status: 'dead',
              nextRunAt: new Date(),
              lastError: deleteResult.error.message,
            })
          : command.mode === 'soft'
            ? await failRecoverableTableSchemaOperation(
                unitOfWork,
                tableRepository,
                context,
                table,
                {
                  type: 'table.delete',
                  status: 'dead',
                  nextRunAt: new Date(),
                  lastError: deleteResult.error.message,
                }
              )
            : await failTableSchemaOperation(unitOfWork, tableRepository, context, table, {
                type: 'table.delete',
                lastError: deleteResult.error.message,
              });
        if (failResult.isErr()) {
          logger.warn('DeleteTableHandler.failStateUpdateFailed', {
            error: failResult.error.message,
            originalError: deleteResult.error.message,
          });
        }
        return err(deleteResult.error);
      }
      yield* await completeTableSchemaOperation(unitOfWork, tableRepository, context, table, {
        type: 'table.delete',
      });
      if (command.mode === 'permanent') {
        yield* table.markDeleted();
      } else {
        yield* table.markTrashed();
      }
      const responseEvents = [...sideEffectEvents, ...table.pullDomainEvents()];
      yield* await eventBus.publishMany(context, [
        ...responseEvents,
        ...sideEffectPostPersistEvents,
      ]);
      return ok(DeleteTableResult.create(table, responseEvents));
    });
    if (result.isOk()) {
      logger.debug('DeleteTableHandler.success', {
        eventCount: result.value.events.length,
      });
    }
    return result;
  }
}
