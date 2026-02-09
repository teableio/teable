import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Field } from '../domain/table/fields/Field';
import type { Table } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
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
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateFieldCommand
  ): Promise<Result<CreateFieldResult, DomainError>> {
    const handler = this;
    return safeTry<CreateFieldResult, DomainError>(async function* () {
      const foreignTableReferences = yield* command.foreignTableReferences();
      const foreignTables = yield* await handler.foreignTableLoaderService.load(context, {
        baseId: command.baseId,
        references: foreignTableReferences,
      });
      let createdField: Field | undefined;
      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { baseId: command.baseId, tableId: command.tableId },
        (table) => {
          const existingNames = table.getFields().map((field) => field.name().toString());
          return resolveTableFieldInputName(command.field, existingNames, {
            t: context.$t,
            hostTable: table,
            foreignTables,
          }).andThen((resolved) =>
            parseTableFieldSpec(resolved, { isPrimary: false })
              .andThen((spec) =>
                spec.createField({ baseId: command.baseId, tableId: command.tableId })
              )
              .andThen((field) => {
                createdField = field;
                return table.update((mutator) => mutator.addField(field, { foreignTables }));
              })
          );
        },
        {
          hooks: {
            afterPersist: async (transactionContext, updatedTable) =>
              safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
                if (!createdField)
                  return err(domainError.unexpected({ message: 'Field not created' }));
                const sideEffectResult =
                  yield* await handler.fieldCreationSideEffectService.execute(transactionContext, {
                    table: updatedTable,
                    fields: [createdField],
                    foreignTables,
                  });

                return ok(sideEffectResult.events);
              }),
          },
        }
      );
      return ok(CreateFieldResult.create(updateResult.table, updateResult.events));
    });
  }
}
