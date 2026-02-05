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
    private readonly tableUpdateFlow: TableUpdateFlow
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RenameTableCommand
  ): Promise<Result<RenameTableResult, DomainError>> {
    const handler = this;
    return safeTry<RenameTableResult, DomainError>(async function* () {
      const updateResult = yield* await handler.tableUpdateFlow.execute(context, command, (table) =>
        table.update((mutator) => mutator.rename(command.tableName))
      );
      return ok(RenameTableResult.create(updateResult.table, updateResult.events));
    });
  }
}
