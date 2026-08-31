import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import type { DomainError } from '../domain/shared/DomainError';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import { rehydrateViewSnapshot } from '../domain/table/views/ViewSnapshot';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TeableSpanAttributes } from '../ports/Tracer';
import { TraceSpan } from '../ports/TraceSpan';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
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
export class ApplyViewSnapshotHandler
  implements ICommandHandler<ApplyViewSnapshotCommand, ApplyViewSnapshotResult>
{
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
    const handler = this;
    return safeTry<ApplyViewSnapshotResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const snapshotView = yield* rehydrateViewSnapshot(command.snapshot);
      const snapshotQueryDefaults = yield* snapshotView.queryDefaults();
      const isRestore = table.getView(snapshotView.id()).isErr();
      const snapshotResult = yield* table.applyViewSnapshot(snapshotView);
      if (!snapshotResult.updateResult) {
        return ok(ApplyViewSnapshotResult.create(table));
      }

      const pluginExecution = yield* await handler.viewOperationPluginRunner.prepare(
        isRestore
          ? {
              kind: ViewOperationKind.create,
              executionContext: context,
              payload: {
                tableId: table.id().toString(),
                currentViewCount: table.views().length,
                addedViewCount: 1,
                view: {
                  name: snapshotView.name().toString(),
                  description: snapshotView.description(),
                  filter: snapshotQueryDefaults.filter(),
                  sort: snapshotQueryDefaults.sort(),
                  group: snapshotQueryDefaults.group(),
                  options: snapshotView.options(),
                },
              },
              isTransactionBound: false,
            }
          : {
              kind: ViewOperationKind.update,
              executionContext: context,
              payload: {
                tableId: table.id().toString(),
                viewId: snapshotView.id().toString(),
                patch: {
                  name: snapshotView.name().toString(),
                  description: snapshotView.description(),
                  isLocked: snapshotView.isLocked(),
                  shareMeta: snapshotView.shareMeta(),
                  order: command.snapshot.order,
                  columnMeta: command.snapshot.columnMeta,
                  filter: snapshotQueryDefaults.filter(),
                  sort: snapshotQueryDefaults.sort(),
                  group: snapshotQueryDefaults.group(),
                  options: snapshotView.options(),
                },
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
