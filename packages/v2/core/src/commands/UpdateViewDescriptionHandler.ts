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
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateViewDescriptionCommand } from './UpdateViewDescriptionCommand';

export class UpdateViewDescriptionResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly previousDescription: string | undefined,
    readonly nextDescription: string,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(params: {
    table: Table;
    viewId: ViewId;
    previousDescription: string | undefined;
    nextDescription: string;
    events: ReadonlyArray<IDomainEvent>;
  }): UpdateViewDescriptionResult {
    return new UpdateViewDescriptionResult(
      params.table,
      params.viewId,
      params.previousDescription,
      params.nextDescription,
      [...params.events]
    );
  }
}

@CommandHandler(UpdateViewDescriptionCommand)
@injectable()
export class UpdateViewDescriptionHandler
  implements ICommandHandler<UpdateViewDescriptionCommand, UpdateViewDescriptionResult>
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
    command: UpdateViewDescriptionCommand
  ): Promise<Result<UpdateViewDescriptionResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateViewDescriptionResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const previousSnapshot = yield* handler.viewUndoRedoService.capture(
        table,
        command.viewId.toString()
      );
      const descriptionResult = yield* table.updateViewDescription(
        command.viewId,
        command.description
      );

      const pluginExecution = yield* await handler.viewOperationPluginRunner.prepare({
        kind: ViewOperationKind.update,
        executionContext: context,
        payload: {
          tableId: table.id().toString(),
          viewId: command.viewId.toString(),
          patch: { description: command.description },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const updateResult = yield* await handler.tableUpdateFlow.execute(context, { table }, () =>
        ok(descriptionResult.updateResult)
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
        UpdateViewDescriptionResult.create({
          table: updateResult.table,
          viewId: command.viewId,
          previousDescription: descriptionResult.previousDescription,
          nextDescription: descriptionResult.nextDescription,
          events: updateResult.events,
        })
      );
    });
  }
}
