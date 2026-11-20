import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry, type Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import { rehydrateViewTrashSnapshot } from '../domain/table/views/ViewSnapshot';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import * as ViewTrashSnapshotReaderPort from '../ports/ViewTrashSnapshotReader';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RestoreViewCommand } from './RestoreViewCommand';

export class RestoreViewResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): RestoreViewResult {
    return new RestoreViewResult(table, events);
  }
}

@CommandHandler(RestoreViewCommand)
@injectable()
export class RestoreViewHandler implements ICommandHandler<RestoreViewCommand, RestoreViewResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.viewTrashSnapshotReader)
    private readonly viewTrashSnapshotReader: ViewTrashSnapshotReaderPort.IViewTrashSnapshotReader,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.viewOperationPluginRunner)
    private readonly viewOperationPluginRunner: ViewOperationPluginRunner,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreViewCommand
  ): Promise<Result<RestoreViewResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    const transactionResult = await this.unitOfWork.withTransaction(
      context,
      async (transactionContext) =>
        await safeTry<RestoreViewResult, DomainError>(async function* () {
          const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
          const table = yield* await handler.tableRepository.findOne(
            transactionContext,
            tableSpec,
            {
              lock: 'forUpdate',
              state: 'activeWithPending',
            }
          );
          if (table.getView(command.viewId).isOk()) {
            return err(
              domainError.conflict({ code: 'view.already_exists', message: 'View already exists' })
            );
          }
          const snapshot = yield* await handler.viewTrashSnapshotReader.get(
            transactionContext,
            command.tableId,
            command.viewId
          );
          if (snapshot.id !== command.viewId.toString()) {
            return err(
              domainError.unexpected({ message: 'View trash snapshot identity mismatch' })
            );
          }
          const view = yield* rehydrateViewTrashSnapshot(snapshot);
          const query = yield* view.queryDefaults();
          const restored = yield* table.applyViewSnapshot(view);
          if (!restored.updateResult) return ok(RestoreViewResult.create(table, []));
          const restoredView = yield* restored.updateResult.table.getView(view.id());
          const execution = yield* await handler.viewOperationPluginRunner.prepare({
            kind: ViewOperationKind.create,
            executionContext: transactionContext,
            payload: {
              tableId: table.id().toString(),
              currentViewCount: table.views().length,
              addedViewCount: 1,
              view: {
                name: view.name().toString(),
                description: view.description(),
                filter: query.filter(),
                sort: query.sort(),
                group: query.group(),
                columnMeta: (yield* restoredView.columnMeta()).toDto(),
                options: view.options(),
              },
            },
            isTransactionBound: true,
          });
          yield* await execution.guard();
          const update = yield* await handler.tableUpdateFlow.execute(
            transactionContext,
            { table },
            () => ok(restored.updateResult!),
            { publishEvents: false }
          );
          return ok(
            RestoreViewResult.create(update.table, [...update.events, ...update.postPersistEvents])
          );
        }),
      { scope: 'meta' }
    );
    if (transactionResult.isErr()) return err(transactionResult.error);
    if (transactionResult.value.events.length) {
      const published = await this.eventBus.publishMany(context, transactionResult.value.events);
      if (published.isErr()) return err(published.error);
    }
    return ok(transactionResult.value);
  }
}
