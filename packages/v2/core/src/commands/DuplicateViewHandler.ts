import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { ViewPluginCreationService } from '../application/services/ViewPluginCreationService';
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
import { DuplicateViewCommand } from './DuplicateViewCommand';

export class DuplicateViewResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    table: Table,
    viewId: ViewId,
    events: ReadonlyArray<IDomainEvent>
  ): DuplicateViewResult {
    return new DuplicateViewResult(table, viewId, [...events]);
  }
}

@CommandHandler(DuplicateViewCommand)
@injectable()
export class DuplicateViewHandler
  implements ICommandHandler<DuplicateViewCommand, DuplicateViewResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.viewOperationPluginRunner)
    private readonly viewOperationPluginRunner: ViewOperationPluginRunner,
    @inject(v2CoreTokens.viewPluginCreationService)
    private readonly viewPluginCreationService: ViewPluginCreationService,
    @inject(v2CoreTokens.viewUndoRedoService)
    private readonly viewUndoRedoService: ViewUndoRedoService
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DuplicateViewCommand
  ): Promise<Result<DuplicateViewResult, DomainError>> {
    const handler = this;
    return safeTry<DuplicateViewResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs()
        .byId(command.tableId)
        .withPrimaryField()
        .build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const prepared = yield* await handler.viewPluginCreationService.prepareDuplicate(
        context,
        table,
        command.viewId
      );
      const duplicateResult = yield* table.duplicateView(command.viewId, prepared.input);
      const { view, updateResult: viewUpdateResult } = duplicateResult;
      const pluginInstallation = handler.viewPluginCreationService.completeInstallation(
        prepared,
        view
      );
      const queryDefaults = yield* view.queryDefaults();

      const pluginExecution = yield* await handler.viewOperationPluginRunner.prepare({
        kind: ViewOperationKind.duplicate,
        executionContext: context,
        payload: {
          tableId: table.id().toString(),
          currentViewCount: table.views().length,
          addedViewCount: 1,
          sourceViewId: command.viewId.toString(),
          view: {
            name: view.name().toString(),
            description: view.description(),
            filter: queryDefaults.filter(),
            sort: queryDefaults.sort(),
            group: queryDefaults.group(),
            options: view.options(),
          },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const installation = pluginInstallation;
      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { table },
        () => ok(viewUpdateResult),
        installation
          ? {
              hooks: {
                prepare: async (transactionContext) =>
                  handler.viewPluginCreationService
                    .insertInstallation(transactionContext, installation)
                    .then((result) => result.map(() => [] as ReadonlyArray<IDomainEvent>)),
              },
            }
          : undefined
      );
      const snapshot = yield* handler.viewUndoRedoService.capture(
        updateResult.table,
        view.id().toString()
      );
      yield* await handler.viewUndoRedoService.appendCreate(context, updateResult.table, snapshot);
      return ok(DuplicateViewResult.create(updateResult.table, view.id(), updateResult.events));
    });
  }
}
