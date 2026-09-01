import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry, type Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import type { ViewId } from '../domain/table/views/ViewId';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ViewOperationKind } from '../ports/ViewOperationPlugin';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RefreshViewShareIdCommand } from './RefreshViewShareIdCommand';

export class RefreshViewShareIdResult {
  private constructor(
    readonly table: Table,
    readonly viewId: ViewId,
    readonly previousShareId: string | undefined,
    readonly shareId: string,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(params: {
    table: Table;
    viewId: ViewId;
    previousShareId: string | undefined;
    shareId: string;
    events: ReadonlyArray<IDomainEvent>;
  }): RefreshViewShareIdResult {
    return new RefreshViewShareIdResult(
      params.table,
      params.viewId,
      params.previousShareId,
      params.shareId,
      [...params.events]
    );
  }
}

@CommandHandler(RefreshViewShareIdCommand)
@injectable()
export class RefreshViewShareIdHandler
  implements ICommandHandler<RefreshViewShareIdCommand, RefreshViewShareIdResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.viewOperationPluginRunner)
    private readonly viewOperationPluginRunner: ViewOperationPluginRunner
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RefreshViewShareIdCommand
  ): Promise<Result<RefreshViewShareIdResult, DomainError>> {
    const handler = this;
    return safeTry<RefreshViewShareIdResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const refreshResult = yield* table.refreshViewShareId(command.viewId);

      const pluginExecution = yield* await handler.viewOperationPluginRunner.prepare({
        kind: ViewOperationKind.update,
        executionContext: context,
        payload: {
          tableId: table.id().toString(),
          viewId: command.viewId.toString(),
          patch: { shareId: refreshResult.nextShareId },
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const update = yield* await handler.tableUpdateFlow.execute(context, { table }, () =>
        ok(refreshResult.updateResult)
      );
      return ok(
        RefreshViewShareIdResult.create({
          table: update.table,
          viewId: command.viewId,
          previousShareId: refreshResult.previousShareId,
          shareId: refreshResult.nextShareId,
          events: update.events,
        })
      );
    });
  }
}
