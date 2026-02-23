import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { AndSpec } from '../domain/shared/specification/AndSpec';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { Field } from '../domain/table/fields/Field';
import { ConditionalLookupField } from '../domain/table/fields/types/ConditionalLookupField';
import { ConditionalRollupField } from '../domain/table/fields/types/ConditionalRollupField';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { LookupField } from '../domain/table/fields/types/LookupField';
import { RollupField } from '../domain/table/fields/types/RollupField';
import { LinkForeignTableReferenceVisitor } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { TableUpdateFieldHasErrorSpec } from '../domain/table/specs/TableUpdateFieldHasErrorSpec';
import { Table as TableAggregate } from '../domain/table/Table';
import type { Table } from '../domain/table/Table';
import { TableUpdateResult } from '../domain/table/TableMutator';
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

                // Cross-table cleanup: mark fields in other tables as errored
                // if they reference the deleted field (in filter conditions or as lookupFieldId)
                const crossTableEvents = yield* await handler.executeCrossTableDeletionCleanup(
                  transactionContext,
                  updatedTable,
                  deletedField
                );

                return ok([...events, ...crossTableEvents]);
              }),
          },
        }
      );

      return ok(DeleteFieldResult.create(updateResult.table, updateResult.events));
    });
  }

  /**
   * Mark fields in other tables as errored when they reference the deleted field.
   *
   * This handles the case where:
   * - A ConditionalRollupField/ConditionalLookupField has a filter referencing the deleted field
   * - A RollupField/LookupField/ConditionalRollupField uses the deleted field as lookupFieldId
   * - A RollupField/LookupField uses the deleted field as linkFieldId
   */
  private async executeCrossTableDeletionCleanup(
    context: ExecutionContextPort.IExecutionContext,
    sourceTable: Table,
    deletedField: Field
  ): Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>> {
    const handler = this;
    return safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
      const allTablesSpec = yield* TableAggregate.specs(sourceTable.baseId()).build();
      const allTables = yield* await handler.tableRepository.find(context, allTablesSpec);

      const events: IDomainEvent[] = [];

      for (const candidateTable of allTables) {
        if (candidateTable.id().equals(sourceTable.id())) continue;

        const specs = handler.buildDeletionCleanupSpecs(candidateTable, sourceTable, deletedField);
        if (specs.length === 0) continue;

        let composedSpec: ISpecification<Table, ITableSpecVisitor> = specs[0]!;
        for (let i = 1; i < specs.length; i++) {
          composedSpec = new AndSpec<Table, ITableSpecVisitor>(composedSpec, specs[i]!);
        }

        const updateResult = yield* await handler.tableUpdateFlow.execute(
          context,
          { table: candidateTable },
          (table) => {
            let updated = table;
            for (const spec of specs) {
              const result = spec.mutate(updated);
              if (result.isErr()) return err(result.error);
              updated = result.value;
            }
            return ok(TableUpdateResult.create(updated, composedSpec));
          },
          { publishEvents: false }
        );
        events.push(...updateResult.events);
      }

      return ok(events);
    });
  }

  private buildDeletionCleanupSpecs(
    candidateTable: Table,
    sourceTable: Table,
    deletedField: Field
  ): Array<ISpecification<Table, ITableSpecVisitor>> {
    const specs: Array<ISpecification<Table, ITableSpecVisitor>> = [];
    const deletedFieldId = deletedField.id();

    for (const field of candidateTable.getFields()) {
      if (!this.referencesTable(field, sourceTable)) continue;

      let shouldMarkError = false;

      if (field instanceof RollupField) {
        shouldMarkError =
          field.lookupFieldId().equals(deletedFieldId) ||
          field.linkFieldId().equals(deletedFieldId);
      } else if (field instanceof ConditionalRollupField) {
        shouldMarkError =
          field.lookupFieldId().equals(deletedFieldId) ||
          field.config().condition().referencesField(deletedFieldId);
      } else if (field instanceof LookupField) {
        shouldMarkError =
          field.lookupFieldId().equals(deletedFieldId) ||
          field.linkFieldId().equals(deletedFieldId);
      } else if (field instanceof ConditionalLookupField) {
        shouldMarkError =
          field.lookupFieldId().equals(deletedFieldId) ||
          field.conditionalLookupOptions().condition().referencesField(deletedFieldId);
      }

      if (shouldMarkError && !field.hasError().isError()) {
        specs.push(TableUpdateFieldHasErrorSpec.setError(field.id(), field.hasError()));
      }
    }

    return specs;
  }

  private referencesTable(field: Field, sourceTable: Table): boolean {
    if (
      field instanceof LinkField ||
      field instanceof LookupField ||
      field instanceof RollupField ||
      field instanceof ConditionalLookupField ||
      field instanceof ConditionalRollupField
    ) {
      return field.foreignTableId().equals(sourceTable.id());
    }
    return false;
  }
}
