import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { Field } from '../domain/table/fields/Field';
import { LinkForeignTableReferenceVisitor } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { Table as TableAggregate } from '../domain/table/Table';
import type { Table } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteFieldCommand } from './DeleteFieldCommand';

export class DeleteFieldResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): DeleteFieldResult {
    return new DeleteFieldResult(table, [...events]);
  }
}

@CommandHandler(DeleteFieldCommand)
@injectable()
export class DeleteFieldHandler implements ICommandHandler<DeleteFieldCommand, DeleteFieldResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldDeletionSideEffectService)
    private readonly fieldDeletionSideEffectService: FieldDeletionSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteFieldCommand
  ): Promise<Result<DeleteFieldResult, DomainError>> {
    const handler = this;
    return safeTry<DeleteFieldResult, DomainError>(async function* () {
      const specResult = yield* TableAggregate.specs(command.baseId).byId(command.tableId).build();
      const tableResult = await handler.tableRepository.findOne(context, specResult);
      if (tableResult.isErr()) {
        if (isNotFoundError(tableResult.error)) {
          return err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
        }
        return err(tableResult.error);
      }

      const table = tableResult.value;
      const fieldSpec = yield* Field.specs().withFieldId(command.fieldId).build();
      const targetField = table.getFields(fieldSpec)[0];
      if (!targetField) return err(domainError.notFound({ message: 'Field not found' }));

      const referenceVisitor = new LinkForeignTableReferenceVisitor();
      const foreignRefs = yield* referenceVisitor.collect([targetField]);
      const foreignTables = yield* await handler.foreignTableLoaderService.load(context, {
        baseId: command.baseId,
        references: foreignRefs,
      });

      let deletedField: Field | undefined;
      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { table },
        (candidate) => {
          const currentField = candidate.getFields(fieldSpec)[0];
          if (!currentField) return err(domainError.notFound({ message: 'Field not found' }));
          deletedField = currentField;
          return candidate.update((mutator) => mutator.removeField(command.fieldId));
        },
        {
          hooks: {
            afterPersist: async (transactionContext, updatedTable) =>
              safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
                if (!deletedField)
                  return err(domainError.unexpected({ message: 'Field not deleted' }));
                const events = yield* await handler.fieldDeletionSideEffectService.execute(
                  transactionContext,
                  {
                    table: updatedTable,
                    fields: [deletedField],
                    foreignTables,
                  }
                );

                return ok(events);
              }),
          },
        }
      );

      return ok(DeleteFieldResult.create(updateResult.table, updateResult.events));
    });
  }
}
