import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Field } from '../domain/table/fields/Field';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DuplicateFieldCommand } from './DuplicateFieldCommand';

export class DuplicateFieldResult {
  private constructor(
    readonly table: Table,
    readonly sourceField: Field,
    readonly newField: Field,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    table: Table,
    sourceField: Field,
    newField: Field,
    events: ReadonlyArray<IDomainEvent>
  ): DuplicateFieldResult {
    return new DuplicateFieldResult(table, sourceField, newField, [...events]);
  }
}

@CommandHandler(DuplicateFieldCommand)
@injectable()
export class DuplicateFieldHandler
  implements ICommandHandler<DuplicateFieldCommand, DuplicateFieldResult>
{
  constructor(
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldCreationSideEffectService)
    private readonly fieldCreationSideEffectService: FieldCreationSideEffectService
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DuplicateFieldCommand
  ): Promise<Result<DuplicateFieldResult, DomainError>> {
    const handler = this;
    return safeTry<DuplicateFieldResult, DomainError>(async function* () {
      let newField: Field | undefined;
      let sourceField: Field | undefined;

      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { baseId: command.baseId, tableId: command.tableId },
        (table) =>
          safeTry<TableUpdateResult, DomainError>(function* () {
            // Find the source field
            const field = table.getFields().find((f) => f.id().equals(command.fieldId));
            if (!field) {
              return err(
                domainError.notFound({
                  code: 'field.not_found',
                  message: `Field ${command.fieldId.toString()} not found`,
                })
              );
            }
            sourceField = field;

            // Generate new field ID
            const newFieldId = yield* FieldId.generate();

            // Generate new field name
            const existingNames = table.getFields().map((f) => f.name().toString());
            const baseName = command.newFieldName ?? `${field.name().toString()} (copy)`;
            const resolvedName = generateUniqueName(baseName, existingNames);
            const newFieldName = yield* FieldName.create(resolvedName);

            // Clone the source field with new ID and name
            const clonedField = yield* field.duplicate({
              newId: newFieldId,
              newName: newFieldName,
              baseId: command.baseId,
              tableId: command.tableId,
            });
            newField = clonedField;

            // Update table with duplicated field
            // Note: Value duplication happens in the repository visitor (TableSchemaUpdateVisitor)
            // when it visits the TableDuplicateFieldSpec
            const updated = yield* table.update((mutator) =>
              mutator.duplicateField(sourceField!, clonedField, command.includeRecordValues)
            );
            return ok(updated);
          }),
        {
          hooks: {
            afterPersist: async (transactionContext, updatedTable) =>
              safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
                if (!newField || !sourceField) {
                  return err(domainError.unexpected({ message: 'Field not created' }));
                }

                // Execute field creation side effects (e.g., for link fields)
                const sideEffectResult =
                  yield* await handler.fieldCreationSideEffectService.execute(transactionContext, {
                    table: updatedTable,
                    fields: [newField],
                    foreignTables: [],
                  });

                return ok(sideEffectResult.events);
              }),
          },
        }
      );

      if (!newField || !sourceField) {
        return err(domainError.unexpected({ message: 'Field not created' }));
      }

      return ok(
        DuplicateFieldResult.create(updateResult.table, sourceField, newField, updateResult.events)
      );
    });
  }
}

function generateUniqueName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) return baseName;
  let counter = 1;
  let candidate = `${baseName} ${counter}`;
  while (existingNames.includes(candidate)) {
    counter++;
    candidate = `${baseName} ${counter}`;
  }
  return candidate;
}
