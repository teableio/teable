import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { FieldId } from '../domain/table/fields/FieldId';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import type { TableId } from '../domain/table/TableId';
import type { ViewId } from '../domain/table/views/ViewId';
import type { ViewSnapshotValue } from '../domain/table/views/ViewSnapshot';
import * as EventBusPort from '../ports/EventBus';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteViewCommand } from './DeleteViewCommand';

export class DeleteViewResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly deletedSnapshot: ViewSnapshotValue,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    table: Table,
    viewId: ViewId,
    deletedSnapshot: ViewSnapshotValue,
    events: ReadonlyArray<IDomainEvent>
  ): DeleteViewResult {
    return new DeleteViewResult(table, viewId, deletedSnapshot, [...events]);
  }
}

type LinkDependencyGroup = {
  readonly foreignTableId: TableId;
  readonly fieldIds: ReadonlyArray<FieldId>;
};

@CommandHandler(DeleteViewCommand)
@injectable()
export class DeleteViewHandler implements ICommandHandler<DeleteViewCommand, DeleteViewResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.viewUndoRedoService)
    private readonly viewUndoRedoService: ViewUndoRedoService
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteViewCommand
  ): Promise<Result<DeleteViewResult, DomainError>> {
    const handler = this;
    const transactionResult = await this.unitOfWork.withTransaction(
      context,
      async (transactionContext) =>
        safeTry<DeleteViewResult, DomainError>(async function* () {
          const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
          const tableResult = await handler.tableRepository.findOne(transactionContext, tableSpec, {
            lock: 'forUpdate',
          });
          if (tableResult.isErr()) {
            if (isNotFoundError(tableResult.error)) {
              return err(
                domainError.notFound({ code: 'table.not_found', message: 'Table not found' })
              );
            }
            return err(tableResult.error);
          }

          const table = tableResult.value;
          const deletedSnapshot = yield* handler.viewUndoRedoService.capture(
            table,
            command.viewId.toString()
          );
          const deleteResult = yield* table.deleteView(command.viewId);
          const dependencyGroups = handler.groupLinkDependencies(deleteResult.linkDependencies);

          const updateResult = yield* await handler.tableUpdateFlow.execute(
            transactionContext,
            { table },
            () => ok(deleteResult.updateResult),
            {
              publishEvents: false,
              hooks: {
                afterPersist: async (currentContext, updatedTable) =>
                  safeTry(async function* () {
                    const cleanupEvents: IDomainEvent[] = [];
                    let latestSourceTable = updatedTable;

                    for (const group of dependencyGroups) {
                      const foreignTableSpec = yield* TableAggregate.specs()
                        .byId(group.foreignTableId)
                        .build();
                      const foreignTableResult = await handler.tableRepository.findOne(
                        currentContext,
                        foreignTableSpec,
                        { lock: 'forUpdate' }
                      );
                      if (foreignTableResult.isErr()) {
                        if (isNotFoundError(foreignTableResult.error)) continue;
                        return err(foreignTableResult.error);
                      }

                      const cleanupResult =
                        yield* foreignTableResult.value.clearViewFilterDependencies(
                          command.viewId,
                          group.fieldIds
                        );
                      if (!cleanupResult) continue;

                      const foreignUpdateResult = yield* await handler.tableUpdateFlow.execute(
                        currentContext,
                        { table: foreignTableResult.value },
                        () => ok(cleanupResult),
                        { publishEvents: false }
                      );
                      cleanupEvents.push(
                        ...foreignUpdateResult.events,
                        ...foreignUpdateResult.postPersistEvents
                      );
                      if (group.foreignTableId.equals(command.tableId)) {
                        latestSourceTable = foreignUpdateResult.table;
                      }
                    }

                    return ok({ table: latestSourceTable, events: cleanupEvents });
                  }),
              },
            }
          );

          const events = [...updateResult.events, ...updateResult.postPersistEvents];
          return ok(
            DeleteViewResult.create(updateResult.table, command.viewId, deletedSnapshot, events)
          );
        }),
      { scope: 'meta' }
    );

    if (transactionResult.isErr()) return err(transactionResult.error);
    if (transactionResult.value.events.length > 0) {
      const publishResult = await this.eventBus.publishMany(
        context,
        transactionResult.value.events
      );
      if (publishResult.isErr()) return err(publishResult.error);
    }
    const undoRedoResult = await this.viewUndoRedoService.appendDelete(
      context,
      transactionResult.value.table,
      transactionResult.value.deletedSnapshot
    );
    if (undoRedoResult.isErr()) return err(undoRedoResult.error);
    return ok(transactionResult.value);
  }

  private groupLinkDependencies(
    dependencies: ReadonlyArray<{
      foreignTableId: TableId;
      symmetricFieldId: FieldId;
    }>
  ): ReadonlyArray<LinkDependencyGroup> {
    const groups = new Map<string, { foreignTableId: TableId; fieldIds: FieldId[] }>();
    for (const dependency of dependencies) {
      const key = dependency.foreignTableId.toString();
      const group = groups.get(key) ?? {
        foreignTableId: dependency.foreignTableId,
        fieldIds: [],
      };
      if (!group.fieldIds.some((fieldId) => fieldId.equals(dependency.symmetricFieldId))) {
        group.fieldIds.push(dependency.symmetricFieldId);
      }
      groups.set(key, group);
    }

    return [...groups.values()].sort((left, right) =>
      left.foreignTableId.toString().localeCompare(right.foreignTableId.toString())
    );
  }
}
