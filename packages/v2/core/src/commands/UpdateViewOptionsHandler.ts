import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry, type Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import type { ViewId } from '../domain/table/views/ViewId';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateViewOptionsCommand } from './UpdateViewOptionsCommand';

export class UpdateViewOptionsResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly previousOptions: unknown,
    readonly nextOptions: unknown,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(params: {
    table: Table;
    viewId: ViewId;
    previousOptions: unknown;
    nextOptions: unknown;
    events: ReadonlyArray<IDomainEvent>;
  }): UpdateViewOptionsResult {
    return new UpdateViewOptionsResult(
      params.table,
      params.viewId,
      params.previousOptions,
      params.nextOptions,
      [...params.events]
    );
  }
}

@CommandHandler(UpdateViewOptionsCommand)
@injectable()
export class UpdateViewOptionsHandler
  implements ICommandHandler<UpdateViewOptionsCommand, UpdateViewOptionsResult>
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
    command: UpdateViewOptionsCommand
  ): Promise<Result<UpdateViewOptionsResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateViewOptionsResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const previousSnapshot = yield* handler.viewUndoRedoService.capture(
        table,
        command.viewId.toString()
      );
      const optionsResult = yield* table.updateViewOptions(command.viewId, command.options);
      if (!optionsResult.updateResult) {
        return ok(
          UpdateViewOptionsResult.create({
            table,
            viewId: command.viewId,
            previousOptions: optionsResult.previousOptions,
            nextOptions: optionsResult.nextOptions,
            events: [],
          })
        );
      }

      const pluginExecution = yield* await handler.viewOperationPluginRunner.prepare({
        kind: ViewOperationKind.update,
        executionContext: context,
        payload: {
          tableId: table.id().toString(),
          viewId: command.viewId.toString(),
          patch: { options: optionsResult.nextOptions },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const update = yield* await handler.tableUpdateFlow.execute(context, { table }, () =>
        ok(optionsResult.updateResult!)
      );
      const nextSnapshot = yield* handler.viewUndoRedoService.capture(
        update.table,
        command.viewId.toString()
      );
      yield* await handler.viewUndoRedoService.appendUpdate(
        context,
        update.table,
        [previousSnapshot],
        [nextSnapshot]
      );
      return ok(
        UpdateViewOptionsResult.create({
          table: update.table,
          viewId: command.viewId,
          previousOptions: optionsResult.previousOptions,
          nextOptions: optionsResult.nextOptions,
          events: update.events,
        })
      );
    });
  }
}
