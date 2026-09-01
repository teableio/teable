import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { TableViewOrderChange } from '../domain/table/specs/TableUpdateViewOrderSpec';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import type { ViewId } from '../domain/table/views/ViewId';
import type { ViewOrder } from '../domain/table/views/ViewOrder';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateViewOrderCommand } from './UpdateViewOrderCommand';

export class UpdateViewOrderResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly previousOrder: ViewOrder,
    readonly nextOrder: ViewOrder,
    readonly changes: ReadonlyArray<TableViewOrderChange>,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(params: {
    table: Table;
    viewId: ViewId;
    previousOrder: ViewOrder;
    nextOrder: ViewOrder;
    changes: ReadonlyArray<TableViewOrderChange>;
    events: ReadonlyArray<IDomainEvent>;
  }): UpdateViewOrderResult {
    return new UpdateViewOrderResult(
      params.table,
      params.viewId,
      params.previousOrder,
      params.nextOrder,
      [...params.changes],
      [...params.events]
    );
  }
}

@CommandHandler(UpdateViewOrderCommand)
@injectable()
export class UpdateViewOrderHandler
  implements ICommandHandler<UpdateViewOrderCommand, UpdateViewOrderResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.viewOperationPluginRunner)
    private readonly viewOperationPluginRunner: ViewOperationPluginRunner,
    @inject(v2CoreTokens.viewUndoRedoService)
    private readonly viewUndoRedoService: ViewUndoRedoService
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: UpdateViewOrderCommand
  ): Promise<Result<UpdateViewOrderResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateViewOrderResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const previousSnapshots = yield* handler.viewUndoRedoService.captureAll(table);
      const reorder = yield* table.updateViewOrder(
        command.viewId,
        command.anchorId,
        command.position
      );

      const pluginExecution = yield* await handler.viewOperationPluginRunner.prepare({
        kind: ViewOperationKind.update,
        executionContext: context,
        payload: {
          tableId: table.id().toString(),
          viewId: command.viewId.toString(),
          patch: { order: reorder.nextOrder.toNumber() },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const update = yield* await handler.tableUpdateFlow.execute(context, { table }, () =>
        ok(reorder.updateResult)
      );
      const nextSnapshots = yield* handler.viewUndoRedoService.captureAll(update.table);
      yield* await handler.viewUndoRedoService.appendUpdate(
        context,
        update.table,
        previousSnapshots,
        nextSnapshots
      );

      return ok(
        UpdateViewOrderResult.create({
          table: update.table,
          viewId: command.viewId,
          previousOrder: reorder.previousOrder,
          nextOrder: reorder.nextOrder,
          changes: reorder.changes,
          events: update.events,
        })
      );
    });
  }
}
