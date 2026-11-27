import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldOperationPluginRunner } from '../application/services/FieldOperationPluginRunner';
import { guardViewLinkFilterChanges } from '../application/services/guardViewLinkFilterChanges';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { FieldId } from '../domain/table/fields/FieldId';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import type { TableId } from '../domain/table/TableId';
import type { ViewId } from '../domain/table/views/ViewId';
import type { ViewSnapshotValue } from '../domain/table/views/ViewSnapshot';
import { domainWrite, type DomainWriteDecision } from '../ports/DomainWriteTransaction';
import * as DomainWriteTransactionPort from '../ports/DomainWriteTransaction';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
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
    @inject(v2CoreTokens.domainWriteTransaction)
    private readonly domainWriteTransaction: DomainWriteTransactionPort.IDomainWriteTransaction,
    @inject(v2CoreTokens.viewUndoRedoService)
    private readonly viewUndoRedoService: ViewUndoRedoService,
    @inject(v2CoreTokens.fieldOperationPluginRunner)
    private readonly fieldOperationPluginRunner: FieldOperationPluginRunner,
    @inject(v2CoreTokens.viewOperationPluginRunner)
    private readonly viewOperationPluginRunner: ViewOperationPluginRunner = new ViewOperationPluginRunner([], new NoopLogger())
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteViewCommand
  ): Promise<Result<DeleteViewResult, DomainError>> {
    const poisoned = ExecutionContextPort.getBatchRollbackError(context);
    if (poisoned) {
      return err(poisoned);
    }
    return ExecutionContextPort.failBatchResultIfActive(
      context,
      await this.executeHandle(context, command)
    );
  }

  private async executeHandle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteViewCommand
  ): Promise<Result<DeleteViewResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    const admission = await this.viewOperationPluginRunner.prepare({
      kind: ViewOperationKind.delete,
      executionContext: context,
      payload: { tableId: command.tableId.toString(), viewId: command.viewId.toString() },
      isTransactionBound: false,
    });
    if (admission.isErr()) return err(admission.error);
    const allowed = await admission.value.guard();
    if (allowed.isErr()) return err(allowed.error);
    const transactionResult = await this.domainWriteTransaction.execute(
      context,
      async (transactionContext) =>
        safeTry<DomainWriteDecision<DeleteViewResult>, DomainError>(async function* () {
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
                      let owner = latestSourceTable;
                      if (!group.foreignTableId.equals(command.tableId)) {
                        const spec = yield* TableAggregate.specs().byId(group.foreignTableId).build();
                        const loaded = await handler.tableRepository.findOne(currentContext, spec, { lock: 'forUpdate' });
                        if (loaded.isErr()) {
                          if (isNotFoundError(loaded.error)) continue;
                          return err(loaded.error);
                        }
                        owner = loaded.value;
                      }

                      const cleanupResult =
                        yield* owner.clearViewFilterDependencies(
                          command.viewId,
                          group.fieldIds
                        );
                      if (!cleanupResult) continue;
                      yield* await guardViewLinkFilterChanges(handler.fieldOperationPluginRunner, currentContext, updatedTable, owner, cleanupResult, 'deleteView');

                      const foreignUpdateResult = yield* await handler.tableUpdateFlow.execute(
                        currentContext,
                        { table: owner },
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
          // Capture the inverse before commit. A lost reservation or store failure aborts deletion.
          if (command.refreshInverse) {
            yield* await command.refreshInverse(
              ViewUndoRedoService.restoreDeletedView(updateResult.table, deletedSnapshot, events)
            );
          }
          return ok(
            domainWrite.fromEvents(
              DeleteViewResult.create(updateResult.table, command.viewId, deletedSnapshot, events),
              events,
              { tables: [updateResult.table] }
            )
          );
        }),
      { scope: 'meta' }
    );

    if (transactionResult.isErr()) return err(transactionResult.error);
    if (command.refreshInverse) return ok(transactionResult.value.value);
    const { table: updatedTable, deletedSnapshot, events } = transactionResult.value.value;
    if (
      transactionResult.value.status === 'deferred' &&
      ExecutionContextPort.isReusableBatchTransactionScope(context.batchTransaction)
    ) {
      const dispatchContext = ExecutionContextPort.withoutTransaction(context);
      context.batchTransaction.enqueueAfterCommit(async () => {
        const undoRedoResult = await this.viewUndoRedoService.appendDelete(
          dispatchContext,
          updatedTable,
          deletedSnapshot,
          events
        );
        if (undoRedoResult.isErr()) {
          throw new Error(undoRedoResult.error.message);
        }
      });
      return ok(transactionResult.value.value);
    }

    const undoRedoResult = await this.viewUndoRedoService.appendDelete(
      context,
      updatedTable,
      deletedSnapshot,
      events
    );
    if (undoRedoResult.isErr()) return err(undoRedoResult.error);
    return ok(transactionResult.value.value);
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
      group.fieldIds.push(dependency.symmetricFieldId);
      groups.set(key, group);
    }

    return [...groups.values()].sort((a, b) =>
      a.foreignTableId.toString().localeCompare(b.foreignTableId.toString())
    );
  }
}
