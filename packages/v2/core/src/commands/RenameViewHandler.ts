import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import type { ViewId } from '../domain/table/views/ViewId';
import type { ViewName } from '../domain/table/views/ViewName';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RenameViewCommand } from './RenameViewCommand';

export class RenameViewResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly previousName: ViewName,
    readonly nextName: ViewName,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(params: {
    table: Table;
    viewId: ViewId;
    previousName: ViewName;
    nextName: ViewName;
    events: ReadonlyArray<IDomainEvent>;
  }): RenameViewResult {
    return new RenameViewResult(params.table, params.viewId, params.previousName, params.nextName, [
      ...params.events,
    ]);
  }
}

@CommandHandler(RenameViewCommand)
@injectable()
export class RenameViewHandler implements ICommandHandler<RenameViewCommand, RenameViewResult> {
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
    command: RenameViewCommand
  ): Promise<Result<RenameViewResult, DomainError>> {
    const handler = this;
    return safeTry<RenameViewResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const previousSnapshot = yield* handler.viewUndoRedoService.capture(
        table,
        command.viewId.toString()
      );
      const renameResult = yield* table.renameView(command.viewId, command.name);

      const pluginExecution = yield* await handler.viewOperationPluginRunner.prepare({
        kind: ViewOperationKind.update,
        executionContext: context,
        payload: {
          tableId: table.id().toString(),
          viewId: command.viewId.toString(),
          patch: { name: command.name.toString() },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const updateResult = yield* await handler.tableUpdateFlow.execute(context, { table }, () =>
        ok(renameResult.updateResult)
      );
      const nextSnapshot = yield* handler.viewUndoRedoService.capture(
        updateResult.table,
        command.viewId.toString()
      );
      yield* await handler.viewUndoRedoService.appendUpdate(
        context,
        updateResult.table,
        [previousSnapshot],
        [nextSnapshot]
      );

      return ok(
        RenameViewResult.create({
          table: updateResult.table,
          viewId: command.viewId,
          previousName: renameResult.previousName,
          nextName: renameResult.nextName,
          events: updateResult.events,
        })
      );
    });
  }
}
