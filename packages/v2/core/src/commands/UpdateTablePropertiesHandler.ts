import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
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
export class UpdateTablePropertiesHandler
  implements ICommandHandler<UpdateTablePropertiesCommand, UpdateTablePropertiesResult>
{
  constructor(
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: UpdateTablePropertiesCommand
  ): Promise<Result<UpdateTablePropertiesResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateTablePropertiesResult, DomainError>(async function* () {
      const updateResult = yield* await handler.tableUpdateFlow.execute(context, command, (table) =>
        table.update((mutator) => mutator.updateProperties(command.patch))
      );
      return ok(UpdateTablePropertiesResult.create(updateResult.table, updateResult.events));
    });
  }
}
