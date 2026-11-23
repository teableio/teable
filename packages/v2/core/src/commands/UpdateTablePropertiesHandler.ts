import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import { TableOperationKind } from '../ports/TableOperationPlugin';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateTablePropertiesCommand } from './UpdateTablePropertiesCommand';

export class UpdateTablePropertiesResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): UpdateTablePropertiesResult {
    return new UpdateTablePropertiesResult(table, [...events]);
  }
}

@CommandHandler(UpdateTablePropertiesCommand)
@injectable()
export class UpdateTablePropertiesHandler implements ICommandHandler<
  UpdateTablePropertiesCommand,
  UpdateTablePropertiesResult
> {
  constructor(
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.tableOperationPluginRunner)
    private readonly tableOperationPluginRunner: TableOperationPluginRunner = new TableOperationPluginRunner([], new NoopLogger())
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: UpdateTablePropertiesCommand
  ): Promise<Result<UpdateTablePropertiesResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<UpdateTablePropertiesResult, DomainError>(async function* () {
      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        command,
        (table) => table.update((mutator) => mutator.updateProperties(command.patch)),
        {
          beforeMutate: async (table) => {
            const execution = await handler.tableOperationPluginRunner.prepare({
              kind: TableOperationKind.updateProperties,
              executionContext: context,
              payload: { baseId: table.baseId(), table, patch: command.patch },
              isTransactionBound: false,
            });
            return execution.isErr() ? err(execution.error) : execution.value.guard();
          },
        }
      );
      return ok(UpdateTablePropertiesResult.create(updateResult.table, updateResult.events));
    });
  }
}
