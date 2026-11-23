import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import type { DomainError } from '../domain/shared/DomainError';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import { rehydrateViewSnapshot } from '../domain/table/views/ViewSnapshot';
import type { View } from '../domain/table/views/View';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TeableSpanAttributes } from '../ports/Tracer';
import { TraceSpan } from '../ports/TraceSpan';
import { ViewOperationKind, type ViewOperationPayloadViewConfig } from '../ports/ViewOperationPlugin';
import { ApplyViewSnapshotCommand } from './ApplyViewSnapshotCommand';
import { CommandHandler, type ICommandHandler } from './CommandHandler';

export class ApplyViewSnapshotResult {
  private constructor(readonly table: Table) {}

  static create(table: Table): ApplyViewSnapshotResult {
    return new ApplyViewSnapshotResult(table);
  }
}

@CommandHandler(ApplyViewSnapshotCommand)
@injectable()
export class ApplyViewSnapshotHandler implements ICommandHandler<
  ApplyViewSnapshotCommand,
  ApplyViewSnapshotResult
> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.viewOperationPluginRunner)
    private readonly viewOperationPluginRunner: ViewOperationPluginRunner
  ) {}

  @TraceSpan({
    attributes: (_context, command: ApplyViewSnapshotCommand) => ({
      [TeableSpanAttributes.TABLE_ID]: command.tableId.toString(),
      'teable.view_id': command.snapshot.id,
      'teable.undo_redo.command_type': 'ApplyViewSnapshot',
    }),
  })
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ApplyViewSnapshotCommand
  ): Promise<Result<ApplyViewSnapshotResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<ApplyViewSnapshotResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const snapshotView = yield* rehydrateViewSnapshot(command.snapshot);
      const currentView = table.getView(snapshotView.id());
      const isRestore = currentView.isErr();
      const snapshotResult = yield* table.applyViewSnapshot(snapshotView);
      if (!snapshotResult.updateResult) {
        return ok(ApplyViewSnapshotResult.create(table));
      }
      // plugins must observe what the aggregate persists, not the raw undo entry
      const restoredView = yield* snapshotResult.updateResult.table.getView(snapshotView.id());
      const configFor = (view: View): Result<ViewOperationPayloadViewConfig, DomainError> => safeTry(function* () {
        const query = yield* view.queryDefaults();
        const order = view.order();
        return ok({ name: view.name().toString(), description: view.description(), isLocked: view.isLocked(),
          enableShare: view.enableShare(), shareId: view.shareId(), shareMeta: view.shareMeta(),
          ...(order.isOk() ? { order: order.value.toNumber() } : {}), columnMeta: (yield* view.columnMeta()).toDto(),
          filter: query.filter(), sort: query.sort(), group: query.group(), options: view.options() });
      });
      const restoredConfig = yield* configFor(restoredView);
      const previousConfig = currentView.isOk() ? yield* configFor(currentView.value) : undefined;
      const patch: ViewOperationPayloadViewConfig = previousConfig
        ? {
            // Authorize repaired visibility even when it matches the current layout,
            // without adding column updates to unrelated sharing-only replays.
            ...(JSON.stringify(restoredConfig.columnMeta) !==
            JSON.stringify(command.snapshot.columnMeta)
              ? { columnMeta: restoredConfig.columnMeta }
              : {}),
            ...Object.fromEntries(
              Object.entries(restoredConfig).filter(
                ([key, value]) =>
                  JSON.stringify(value) !==
                  JSON.stringify(previousConfig[key as keyof ViewOperationPayloadViewConfig])
              )
            ),
          }
        : restoredConfig;

      const pluginExecution = yield* await handler.viewOperationPluginRunner.prepare(
        isRestore
          ? {
              kind: ViewOperationKind.create,
              executionContext: context,
              payload: {
                tableId: table.id().toString(),
                currentViewCount: table.views().length,
                addedViewCount: 1,
                source: 'snapshotRestore',
                view: restoredConfig,
              },
              isTransactionBound: false,
            }
          : {
              kind: ViewOperationKind.update,
              executionContext: context,
              payload: {
                tableId: table.id().toString(),
                viewId: snapshotView.id().toString(),
                patch,
              },
              isTransactionBound: false,
            }
      );
      yield* await pluginExecution.guard();

      const updateResult = yield* await handler.tableUpdateFlow.execute(context, { table }, () =>
        ok(snapshotResult.updateResult!)
      );
      return ok(ApplyViewSnapshotResult.create(updateResult.table));
    });
  }
}
