import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectFlow } from '../application/services/FieldCreationSideEffectFlow';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateFieldCommand } from './CreateFieldCommand';

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
    @inject(v2CoreTokens.fieldCreationSideEffectFlow)
    private readonly fieldCreationSideEffectFlow: FieldCreationSideEffectFlow,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
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

    const tableUpdateFlow = this.tableUpdateFlow;
    const fieldCreationSideEffectFlow = this.fieldCreationSideEffectFlow;
    const eventBus = this.eventBus;
    const baseId = command.baseId;
    const result = await safeTry<CreateFieldResult, string>(async function* () {
      const sideEffectEvents: IDomainEvent[] = [];
      const updateResult = yield* await tableUpdateFlow.execute(
        context,
        { baseId: command.baseId, tableId: command.tableId },
        (table) => table.update((mutator) => mutator.addField(command.field)),
        async (transactionContext, updatedTable) => {
          const hookResult = safeTry<void, string>(async function* () {
            const sideEffects = yield* await fieldCreationSideEffectFlow.execute({
              context: transactionContext,
              baseId,
              table: updatedTable,
              fields: [command.field],
            });
            sideEffectEvents.push(...sideEffects);
            return ok(undefined);
          });
          return await hookResult;
        },
        { deferPublish: true }
      );
      const events = [...updateResult.events, ...sideEffectEvents];
      yield* await eventBus.publishMany(context, events);
      return ok(CreateFieldResult.create(updateResult.table, events));
    });
    if (result.isOk()) {
      this.logger.debug('CreateFieldHandler.success', {
        baseId: command.baseId.toString(),
        tableId: command.tableId.toString(),
        fieldId: command.field.id().toString(),
        eventCount: result.value.events.length,
      });
    }
    return result;
  }
}
