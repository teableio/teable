import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Field } from '../domain/table/fields/Field';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import { IExecutionContext } from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateFieldCommand } from './CreateFieldCommand';
import { parseTableFieldSpec, resolveTableFieldInputName } from './TableFieldSpecs';

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
    @inject(v2CoreTokens.fieldCreationSideEffectService)
    private readonly fieldCreationSideEffectService: FieldCreationSideEffectService,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus
  ) {}

  @TraceSpan()
  async handle(
    context: IExecutionContext,
    command: CreateFieldCommand
  ): Promise<Result<CreateFieldResult, string>> {
    const handler = this;
    return safeTry<CreateFieldResult, string>(async function* () {
      const sideEffectEvents: IDomainEvent[] = [];
      let createdField: Field | undefined;
      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { baseId: command.baseId, tableId: command.tableId },
        (table) => {
          const existingNames = table.fields().map((field) => field.name().toString());
          return resolveTableFieldInputName(command.field, existingNames).andThen((resolved) =>
            parseTableFieldSpec(resolved, { isPrimary: false })
              .andThen((spec) =>
                spec.createField({ baseId: command.baseId, tableId: command.tableId })
              )
              .andThen((field) => {
                createdField = field;
                return table.update((mutator) => mutator.addField(field));
              })
          );
        },
        {
          deferPublish: true,
          prepare: async (transactionContext, updatedTable) => {
            const hookResult = safeTry<void, string>(async function* () {
              if (!createdField) return err('Field not created');
              const sideEffects = yield* await handler.fieldCreationSideEffectService.execute({
                context: transactionContext,
                table: updatedTable,
                fields: [createdField],
              });
              sideEffectEvents.push(...sideEffects);
              return ok(undefined);
            });
            return await hookResult;
          },
        }
      );
      const events = [...updateResult.events, ...sideEffectEvents];
      yield* await handler.eventBus.publishMany(context, events);
      return ok(CreateFieldResult.create(updateResult.table, events));
    });
  }
}
