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
import { EnableViewShareCommand } from './EnableViewShareCommand';

export class EnableViewShareResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly shareId: string,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(params: {
    table: Table;
    viewId: ViewId;
    shareId: string;
    events: ReadonlyArray<IDomainEvent>;
  }): EnableViewShareResult {
    return new EnableViewShareResult(params.table, params.viewId, params.shareId, [
      ...params.events,
    ]);
  }
}

@CommandHandler(EnableViewShareCommand)
@injectable()
export class EnableViewShareHandler
  implements ICommandHandler<EnableViewShareCommand, EnableViewShareResult>
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
    command: EnableViewShareCommand
  ): Promise<Result<EnableViewShareResult, DomainError>> {
    const handler = this;
    return safeTry<EnableViewShareResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const shareResult = yield* table.enableViewShare(command.viewId);

      const pluginExecution = yield* await handler.viewOperationPluginRunner.prepare({
        kind: ViewOperationKind.update,
        executionContext: context,
        payload: {
          tableId: table.id().toString(),
          viewId: command.viewId.toString(),
          patch: {
            enableShare: true,
            shareId: shareResult.shareId,
            shareMeta: shareResult.view.shareMeta(),
          },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const update = yield* await handler.tableUpdateFlow.execute(context, { table }, () =>
        ok(shareResult.updateResult)
      );
      yield* await handler.viewUndoRedoService.appendShareLifecycle(
        context,
        update.table,
        command.viewId.toString(),
        'enable'
      );
      return ok(
        EnableViewShareResult.create({
          table: update.table,
          viewId: command.viewId,
          shareId: shareResult.shareId,
          events: update.events,
        })
      );
    });
  }
}
