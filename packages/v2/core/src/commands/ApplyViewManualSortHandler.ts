import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry, type Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewManualSortService } from '../application/services/ViewManualSortService';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import type { ViewId } from '../domain/table/views/ViewId';
import type { ViewSortDTO, ViewSortItem } from '../domain/table/views/ViewSort';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { ApplyViewManualSortCommand } from './ApplyViewManualSortCommand';
import { CommandHandler, type ICommandHandler } from './CommandHandler';

export class ApplyViewManualSortResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly sort: ReadonlyArray<ViewSortItem>,
    readonly previousSort: ViewSortDTO,
    readonly nextSort: ViewSortDTO,
    readonly updatedRecordCount: number,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(params: {
    table: Table;
    viewId: ViewId;
    sort: ReadonlyArray<ViewSortItem>;
    previousSort: ViewSortDTO;
    nextSort: ViewSortDTO;
    updatedRecordCount: number;
    events: ReadonlyArray<IDomainEvent>;
  }): ApplyViewManualSortResult {
    return new ApplyViewManualSortResult(
      params.table,
      params.viewId,
      params.sort.map((item) => ({ ...item })),
      params.previousSort,
      params.nextSort,
      params.updatedRecordCount,
      [...params.events]
    );
  }
}

@CommandHandler(ApplyViewManualSortCommand)
@injectable()
export class ApplyViewManualSortHandler
  implements ICommandHandler<ApplyViewManualSortCommand, ApplyViewManualSortResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.viewManualSortService)
    private readonly viewManualSortService: ViewManualSortService,
    @inject(v2CoreTokens.viewOperationPluginRunner)
    private readonly viewOperationPluginRunner: ViewOperationPluginRunner,
    @inject(v2CoreTokens.viewUndoRedoService)
    private readonly viewUndoRedoService: ViewUndoRedoService
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ApplyViewManualSortCommand
  ): Promise<Result<ApplyViewManualSortResult, DomainError>> {
    const handler = this;
    return safeTry<ApplyViewManualSortResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const previousSnapshot = yield* handler.viewUndoRedoService.capture(
        table,
        command.viewId.toString()
      );
      const manualSortResult = yield* table.applyViewManualSort(command.viewId, command.sort);

      if (!manualSortResult.updateResult) {
        return ok(
          ApplyViewManualSortResult.create({
            table,
            viewId: command.viewId,
            sort: manualSortResult.sort,
            previousSort: manualSortResult.previousSort,
            nextSort: manualSortResult.nextSort,
            updatedRecordCount: 0,
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
          patch: { sort: manualSortResult.nextSort },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();
      yield* await handler.viewManualSortService.prepareStorage(
        context,
        table,
        manualSortResult.rowOrderStorageSpec
      );

      let updatedRecordCount = 0;
      const update = yield* await handler.tableUpdateFlow.execute(
        context,
        { table },
        () => ok(manualSortResult.updateResult!),
        {
          hooks: {
            afterPersist: async (transactionContext, persistedTable) => {
              const materialized = await handler.viewManualSortService.materialize(
                transactionContext,
                persistedTable,
                command.viewId,
                manualSortResult.sort
              );
              return materialized.map((result) => {
                updatedRecordCount = result.updatedCount;
                return [];
              });
            },
          },
        }
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
        ApplyViewManualSortResult.create({
          table: update.table,
          viewId: command.viewId,
          sort: manualSortResult.sort,
          previousSort: manualSortResult.previousSort,
          nextSort: manualSortResult.nextSort,
          updatedRecordCount,
          events: update.events,
        })
      );
    });
  }
}
