import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry, type Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import type { ViewId } from '../domain/table/views/ViewId';
import type { ViewShareMetaValue } from '../domain/table/views/ViewProperties';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateViewShareMetaCommand } from './UpdateViewShareMetaCommand';

export class UpdateViewShareMetaResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly previousShareMeta: ViewShareMetaValue | undefined,
    readonly nextShareMeta: ViewShareMetaValue | undefined,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(params: {
    table: Table;
    viewId: ViewId;
    previousShareMeta: ViewShareMetaValue | undefined;
    nextShareMeta: ViewShareMetaValue | undefined;
    events: ReadonlyArray<IDomainEvent>;
  }): UpdateViewShareMetaResult {
    return new UpdateViewShareMetaResult(
      params.table,
      params.viewId,
      params.previousShareMeta,
      params.nextShareMeta,
      [...params.events]
    );
  }
}

@CommandHandler(UpdateViewShareMetaCommand)
@injectable()
export class UpdateViewShareMetaHandler
  implements ICommandHandler<UpdateViewShareMetaCommand, UpdateViewShareMetaResult>
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
    command: UpdateViewShareMetaCommand
  ): Promise<Result<UpdateViewShareMetaResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateViewShareMetaResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const previousSnapshot = yield* handler.viewUndoRedoService.capture(
        table,
        command.viewId.toString()
      );
      const shareMetaResult = yield* table.updateViewShareMeta(command.viewId, command.shareMeta);
      if (!shareMetaResult.updateResult) {
        return ok(
          UpdateViewShareMetaResult.create({
            table,
            viewId: command.viewId,
            previousShareMeta: shareMetaResult.previousShareMeta,
            nextShareMeta: shareMetaResult.nextShareMeta,
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
          patch: { shareMeta: shareMetaResult.nextShareMeta },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const update = yield* await handler.tableUpdateFlow.execute(context, { table }, () =>
        ok(shareMetaResult.updateResult!)
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
        UpdateViewShareMetaResult.create({
          table: update.table,
          viewId: command.viewId,
          previousShareMeta: shareMetaResult.previousShareMeta,
          nextShareMeta: shareMetaResult.nextShareMeta,
          events: update.events,
        })
      );
    });
  }
}
