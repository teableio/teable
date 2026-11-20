import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  dispatchSameTxEvents,
  publishEventsWithBatchDeferral,
} from '../application/services/dispatchSameTxEvents';
import { NoopSameTxProjectionDispatcher } from '../application/services/SameTxProjectionDispatcher';
import type {
  ITableDeletionPreparationService,
  TableDeletionPreparation,
} from '../application/services/TableDeletionPreparationService';
import { TableDeletionSideEffectService } from '../application/services/TableDeletionSideEffectService';
import {
  beginTableSchemaOperation,
  completeTableSchemaOperation,
  failRecoverableTableSchemaOperation,
  failTableSchemaOperation,
} from '../application/services/TableSchemaOperationLifecycleService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import type * as SameTxProjectionDispatcherPort from '../ports/SameTxProjectionDispatcher';
import * as TableRepositoryPort from '../ports/TableRepository';
import {
  NoopTableSchemaCoordination,
  type ITableSchemaCoordination,
} from '../ports/TableSchemaCoordination';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteTableCommand } from './DeleteTableCommand';

const TABLE_DELETION_LEASE_WAIT_MS = 5_000;

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
    @inject(v2CoreTokens.tableDeletionPreparationService)
    private readonly tableDeletionPreparationService: ITableDeletionPreparationService,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.tableSchemaCoordination)
    private readonly tableSchemaCoordination: ITableSchemaCoordination = new NoopTableSchemaCoordination(),
    @inject(v2CoreTokens.sameTxProjectionDispatcher)
    private readonly sameTxProjectionDispatcher: SameTxProjectionDispatcherPort.ISameTxProjectionDispatcher = new NoopSameTxProjectionDispatcher()
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteTableCommand
  ): Promise<Result<DeleteTableResult, DomainError>> {
    const poisoned = ExecutionContextPort.getBatchRollbackError(context);
    if (poisoned) {
      return err(poisoned);
    }
    const logger = this.logger.scope('command', { name: DeleteTableHandler.name }).child({
      baseId: command.baseId.toString(),
      tableId: command.tableId.toString(),
      mode: command.mode,
    });
    logger.debug('DeleteTableHandler.start', {
      actorId: context.actorId.toString(),
    });

    const abort = new AbortController();
    let resolveDeadline!: (value: undefined) => void;
    const deadline = new Promise<undefined>((resolve) => {
      resolveDeadline = resolve;
    });
    const timeout = setTimeout(() => {
      abort.abort();
      resolveDeadline(undefined);
    }, TABLE_DELETION_LEASE_WAIT_MS);
    const busy = () =>
      err(
        domainError.conflict({
          code: 'schema_coordination.busy',
          message: 'Table deletion is waiting for an active schema operation; retry the request',
        })
      );
    let tableIds = [command.tableId.toString()];
    try {
      while (true) {
        const leaseResult = await this.tableSchemaCoordination.acquire(
          context,
          tableIds,
          'exclusive',
          abort.signal
        );
        if (abort.signal.aborted) {
          if (leaseResult.isOk()) await leaseResult.value.release();
          return busy();
        }
        if (leaseResult.isErr()) return err(leaseResult.error);
        const lease = leaseResult.value;
        try {
          // Preparation only reads metadata and projects detached aggregates. Discard its late
          // result on expiry; it must never retain this lease or enter the mutation path later.
          const preparationResult = await Promise.race([
            this.tableDeletionPreparationService.prepare(context, command),
            deadline,
          ]);
          if (!preparationResult || abort.signal.aborted) return busy();
          if (preparationResult.isErr()) {
            return err(preparationResult.error);
          }
          const preparation = preparationResult.value;
          const expandedTableIds = Array.from(
            new Set([
              ...tableIds,
              ...preparation.sideEffects.candidatePlans.map(({ sourceTable }) =>
                sourceTable.id().toString()
              ),
            ])
          ).sort();
          if (expandedTableIds.some((tableId) => !lease.tableIds.includes(tableId))) {
            // Release the incomplete set before reacquiring: reciprocal deletions must not each
            // retain their own table while waiting for the other. Reprepare after every expansion.
            tableIds = expandedTableIds;
            continue;
          }
          if (abort.signal.aborted) return busy();
          clearTimeout(timeout);
          return await this.execute(context, preparation, logger);
        } finally {
          await lease.release();
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async execute(
    context: ExecutionContextPort.IExecutionContext,
    preparation: TableDeletionPreparation,
    logger: LoggerPort.ILogger
  ): Promise<Result<DeleteTableResult, DomainError>> {
    const tableRepository = this.tableRepository;
    const tableSchemaRepository = this.tableSchemaRepository;
    const tableDeletionSideEffectService = this.tableDeletionSideEffectService;
    const unitOfWork = this.unitOfWork;
    const eventBus = this.eventBus;
    const sameTxProjectionDispatcher = this.sameTxProjectionDispatcher;
    const result = await safeTry<DeleteTableResult, DomainError>(async function* () {
      // Blockers still precede lifecycle writes, using fresh preparation under the retained lease.
      const blocker = preparation.blockers[0];
      if (blocker) {
        return err(domainError.conflict({ code: blocker.code, message: blocker.message }));
      }
      const table = preparation.table;
      const sideEffectEvents: IDomainEvent[] = [];
      const sideEffectPostPersistEvents: IDomainEvent[] = [];
      const ownEvents: IDomainEvent[] = [];
      yield* await beginTableSchemaOperation(unitOfWork, tableRepository, context, table, {
        type: 'table.delete',
        phase: 'deleting',
        state: 'deleting',
        payload: { mode: preparation.mode },
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
                  const sideEffectResult =
                    yield* await tableDeletionSideEffectService.executePrepared(
                      dataTransactionContext,
                      preparation.sideEffects
                    );
                  sideEffectEvents.push(...sideEffectResult.events);
                  sideEffectPostPersistEvents.push(...sideEffectResult.postPersistEvents);
                  yield* await tableSchemaRepository.delete(dataTransactionContext, table, {
                    mode: preparation.mode,
                  });
                  if (preparation.mode === 'permanent') {
                    yield* table.markDeleted({ sourceState: preparation.sourceState });
                  } else {
                    yield* table.markTrashed();
                  }
                  const tableEvents = table.pullDomainEvents();
                  ownEvents.push(...tableEvents);
                  yield* await dispatchSameTxEvents(
                    dataTransactionContext,
                    sameTxProjectionDispatcher,
                    tableEvents,
                    { previousTables: [table] }
                  );
                  // Stage the target metadata delete before an independent data transaction may
                  // commit. Same-database adapters share one transaction; split adapters return a
                  // metadata SQL failure while the relation conversion can still roll back.
                  yield* await tableRepository.delete(metaTransactionContext, table, {
                    mode: preparation.mode,
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
        if (context.batchTransaction) {
          return err(deleteResult.error);
        }
        // A failure before the data transaction commits rolls both scopes back. Once a split data
        // transaction succeeds, do not replay it through the outer metadata transaction retry loop.
        const failResult = !dataPhaseCompleted
          ? await failRecoverableTableSchemaOperation(unitOfWork, tableRepository, context, table, {
              type: 'table.delete',
              status: 'dead',
              nextRunAt: new Date(),
              lastError: deleteResult.error.message,
            })
          : preparation.mode === 'soft'
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
      const responseEvents = [...sideEffectEvents, ...ownEvents];
      yield* await publishEventsWithBatchDeferral(context, eventBus, [
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
    return ExecutionContextPort.failBatchResultIfActive(context, result);
  }
}
