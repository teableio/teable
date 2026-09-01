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
import type { ViewQueryDefaults } from '../domain/table/views/ViewQueryDefaults';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateViewFilterCommand } from './UpdateViewFilterCommand';

export class UpdateViewFilterResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly previousQueryDefaults: ViewQueryDefaults,
    readonly nextQueryDefaults: ViewQueryDefaults,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(params: {
    table: Table;
    viewId: ViewId;
    previousQueryDefaults: ViewQueryDefaults;
    nextQueryDefaults: ViewQueryDefaults;
    events: ReadonlyArray<IDomainEvent>;
  }): UpdateViewFilterResult {
    return new UpdateViewFilterResult(
      params.table,
      params.viewId,
      params.previousQueryDefaults,
      params.nextQueryDefaults,
      [...params.events]
    );
  }
}

@CommandHandler(UpdateViewFilterCommand)
@injectable()
export class UpdateViewFilterHandler
  implements ICommandHandler<UpdateViewFilterCommand, UpdateViewFilterResult>
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
    command: UpdateViewFilterCommand
  ): Promise<Result<UpdateViewFilterResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateViewFilterResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const previousSnapshot = yield* handler.viewUndoRedoService.capture(
        table,
        command.viewId.toString()
      );
      const filterResult = yield* table.updateViewFilter(command.viewId, command.filter);
      if (!filterResult.updateResult) {
        return ok(
          UpdateViewFilterResult.create({
            table,
            viewId: command.viewId,
            previousQueryDefaults: filterResult.previousQueryDefaults,
            nextQueryDefaults: filterResult.nextQueryDefaults,
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
          patch: { filter: filterResult.nextQueryDefaults.sourceFilter() },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const update = yield* await handler.tableUpdateFlow.execute(context, { table }, () =>
        ok(filterResult.updateResult!)
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
        UpdateViewFilterResult.create({
          table: update.table,
          viewId: command.viewId,
          previousQueryDefaults: filterResult.previousQueryDefaults,
          nextQueryDefaults: filterResult.nextQueryDefaults,
          events: update.events,
        })
      );
    });
  }
}
