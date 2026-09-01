import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import type { ViewColumnMeta, ViewColumnMetaChange } from '../domain/table/views/ViewColumnMeta';
import type { ViewId } from '../domain/table/views/ViewId';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateViewColumnMetaCommand } from './UpdateViewColumnMetaCommand';

export class UpdateViewColumnMetaResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly previousColumnMeta: ViewColumnMeta,
    readonly nextColumnMeta: ViewColumnMeta,
    readonly changes: ReadonlyArray<ViewColumnMetaChange>,
    readonly previousOptions: unknown,
    readonly nextOptions: unknown,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(params: {
    table: Table;
    viewId: ViewId;
    previousColumnMeta: ViewColumnMeta;
    nextColumnMeta: ViewColumnMeta;
    changes: ReadonlyArray<ViewColumnMetaChange>;
    previousOptions?: unknown;
    nextOptions?: unknown;
    events: ReadonlyArray<IDomainEvent>;
  }): UpdateViewColumnMetaResult {
    return new UpdateViewColumnMetaResult(
      params.table,
      params.viewId,
      params.previousColumnMeta,
      params.nextColumnMeta,
      [...params.changes],
      params.previousOptions,
      params.nextOptions,
      [...params.events]
    );
  }
}

@CommandHandler(UpdateViewColumnMetaCommand)
@injectable()
export class UpdateViewColumnMetaHandler
  implements ICommandHandler<UpdateViewColumnMetaCommand, UpdateViewColumnMetaResult>
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
    command: UpdateViewColumnMetaCommand
  ): Promise<Result<UpdateViewColumnMetaResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateViewColumnMetaResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const previousSnapshot = yield* handler.viewUndoRedoService.capture(
        table,
        command.viewId.toString()
      );
      const columnMetaResult = yield* table.updateViewColumnMeta(command.viewId, command.patches);

      if (!columnMetaResult.updateResult) {
        return ok(
          UpdateViewColumnMetaResult.create({
            table,
            viewId: command.viewId,
            previousColumnMeta: columnMetaResult.previousColumnMeta,
            nextColumnMeta: columnMetaResult.nextColumnMeta,
            changes: [],
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
          patch: {
            columnMeta: columnMetaResult.nextColumnMeta.toDto(),
            ...(columnMetaResult.nextOptions !== undefined
              ? { options: columnMetaResult.nextOptions }
              : {}),
          },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const update = yield* await handler.tableUpdateFlow.execute(context, { table }, () =>
        ok(columnMetaResult.updateResult!)
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
        UpdateViewColumnMetaResult.create({
          table: update.table,
          viewId: command.viewId,
          previousColumnMeta: columnMetaResult.previousColumnMeta,
          nextColumnMeta: columnMetaResult.nextColumnMeta,
          changes: columnMetaResult.changes,
          previousOptions: columnMetaResult.previousOptions,
          nextOptions: columnMetaResult.nextOptions,
          events: update.events,
        })
      );
    });
  }
}
