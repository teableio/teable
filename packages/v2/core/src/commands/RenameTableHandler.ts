import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RenameTableCommand } from './RenameTableCommand';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';

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
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    command: RenameTableCommand
  ): Promise<Result<RenameTableResult, string>> {
    this.logger.debug('RenameTableHandler.start', {
      actorId: context.actorId.toString(),
      baseId: command.baseId.toString(),
      tableId: command.tableId.toString(),
      tableName: command.tableName.toString(),
    });

    const tableUpdateFlow = this.tableUpdateFlow;
    const result = await safeTry<RenameTableResult, string>(async function* () {
      const updateResult = yield* await tableUpdateFlow.execute(
        context,
        { baseId: command.baseId, tableId: command.tableId },
        (table) => table.update((mutator) => mutator.rename(command.tableName))
      );
      return ok(RenameTableResult.create(updateResult.table, updateResult.events));
    });
    if (result.isOk()) {
      this.logger.debug('RenameTableHandler.success', {
        baseId: command.baseId.toString(),
        tableId: command.tableId.toString(),
        eventCount: result.value.events.length,
      });
    }
    return result;
  }
}
