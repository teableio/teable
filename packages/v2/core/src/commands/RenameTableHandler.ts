import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import { TableOperationKind } from '../ports/TableOperationPlugin';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RenameTableCommand } from './RenameTableCommand';

export class RenameTableResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): RenameTableResult {
    return new RenameTableResult(table, [...events]);
  }
}

@CommandHandler(RenameTableCommand)
@injectable()
export class RenameTableHandler implements ICommandHandler<RenameTableCommand, RenameTableResult> {
  constructor(
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.tableOperationPluginRunner)
    private readonly tableOperationPluginRunner: TableOperationPluginRunner = new TableOperationPluginRunner(
      [],
      new NoopLogger()
    )
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RenameTableCommand
  ): Promise<Result<RenameTableResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<RenameTableResult, DomainError>(async function* () {
      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        command,
        (table) => table.update((mutator) => mutator.rename(command.tableName)),
        {
          beforeMutate: async (table) => {
            const execution = await handler.tableOperationPluginRunner.prepare({
              kind: TableOperationKind.rename,
              executionContext: context,
              payload: { baseId: command.baseId, tableName: command.tableName, table },
              isTransactionBound: false,
            });
            return execution.isErr() ? err(execution.error) : execution.value.guard();
          },
        }
      );
      return ok(RenameTableResult.create(updateResult.table, updateResult.events));
    });
  }
}
