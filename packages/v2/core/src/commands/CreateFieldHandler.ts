import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateFieldCommand } from './CreateFieldCommand';
import { TableUpdateFlow } from './TableUpdateFlow';

export class CreateFieldResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): CreateFieldResult {
    return new CreateFieldResult(table, [...events]);
  }
}

@CommandHandler(CreateFieldCommand)
@injectable()
export class CreateFieldHandler implements ICommandHandler<CreateFieldCommand, CreateFieldResult> {
  constructor(
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    command: CreateFieldCommand
  ): Promise<Result<CreateFieldResult, string>> {
    this.logger.debug('CreateFieldHandler.start', {
      actorId: context.actorId.toString(),
      baseId: command.baseId.toString(),
      tableId: command.tableId.toString(),
      fieldId: command.field.id().toString(),
      fieldName: command.field.name().toString(),
      fieldType: command.field.type().toString(),
    });

    const updateResult = await this.tableUpdateFlow.execute(
      { context, baseId: command.baseId, tableId: command.tableId },
      (table) => table.update((mutator) => mutator.addField(command.field))
    );
    if (updateResult.isErr()) return err(updateResult.error);
    const { table: updatedTable, events } = updateResult.value;

    this.logger.debug('CreateFieldHandler.success', {
      baseId: command.baseId.toString(),
      tableId: command.tableId.toString(),
      fieldId: command.field.id().toString(),
      eventCount: events.length,
    });

    return ok(CreateFieldResult.create(updatedTable, events));
  }
}
