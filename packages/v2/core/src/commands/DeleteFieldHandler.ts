import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { UndoRedoService } from '../application/services/UndoRedoService';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import {
  composeAndSpecsOrUndefined,
  flattenAndSpecs,
} from '../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { UpdateLinkConfigSpec } from '../domain/table/specs/field-updates/UpdateLinkConfigSpec';
import {
  implementsOnTeableFieldDeleted,
  type FieldDeletionContext,
} from '../domain/table/OnTeableFieldDeleted';
import { Field } from '../domain/table/fields/Field';
import { LinkForeignTableReferenceVisitor } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { TableUpdateFieldHasErrorSpec } from '../domain/table/specs/TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldTypeSpec } from '../domain/table/specs/TableUpdateFieldTypeSpec';
import { TableUpdateViewColumnMetaSpec } from '../domain/table/specs/TableUpdateViewColumnMetaSpec';
import { TableUpdateViewQueryDefaultsSpec } from '../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import { Table as TableAggregate } from '../domain/table/Table';
import type { Table } from '../domain/table/Table';
import { TableUpdateResult } from '../domain/table/TableMutator';
import { implementsOnTeableViewFieldDeleted } from '../domain/table/views/OnTeableViewFieldDeleted';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import {
  composeUndoRedoCommands,
  createUndoRedoCommand,
  type UndoRedoCommandData,
  type UndoRedoFieldSnapshot,
} from '../ports/UndoRedoStore';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteFieldCommand } from './DeleteFieldCommand';

export class DeleteFieldResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>,
    readonly undoCommand: UndoRedoCommandData,
    readonly redoCommand: UndoRedoCommandData
  ) {}

  static create(
    table: Table,
    events: ReadonlyArray<IDomainEvent>,
    undoCommand: UndoRedoCommandData,
    redoCommand: UndoRedoCommandData
  ): DeleteFieldResult {
    return new DeleteFieldResult(table, [...events], undoCommand, redoCommand);
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
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoService: UndoRedoService,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService
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
      const snapshot = yield* await handler.fieldUndoRedoSnapshotService.capture(
        context,
        table,
        command.fieldId
      );
      const relatedUndoSnapshots = yield* await handler.captureRelatedUndoSnapshots(
        context,
        table,
        targetField
      );

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
              safeTry<{ events: ReadonlyArray<IDomainEvent>; table: Table }, DomainError>(
                async function* () {
                  if (!deletedField)
                    return err(domainError.unexpected({ message: 'Field not deleted' }));
                  const sideEffectResult =
                    yield* await handler.fieldDeletionSideEffectService.execute(
                      transactionContext,
                      {
                        table: updatedTable,
                        fields: [deletedField],
                        foreignTables,
                      }
                    );

                  const cleanupResult = yield* await handler.executeDeletionEntityCleanup(
                    transactionContext,
                    updatedTable,
                    table,
                    deletedField
                  );
                  const cleanupEvents: IDomainEvent[] = [...cleanupResult.events];

                  for (const appliedDeletion of sideEffectResult.appliedDeletions) {
                    const appliedCleanupResult = yield* await handler.executeDeletionEntityCleanup(
                      transactionContext,
                      appliedDeletion.table,
                      appliedDeletion.previousTable,
                      appliedDeletion.deletedField
                    );
                    cleanupEvents.push(...appliedCleanupResult.events);
                  }

                  return ok({
                    events: [...sideEffectResult.events, ...cleanupEvents],
                    table: cleanupResult.sourceTable,
                  });
                }
              ),
          },
        }
      );

      const undoCommand = composeUndoRedoCommands([
        createUndoRedoCommand('ApplyFieldSnapshot', {
          baseId: command.baseId.toString(),
          tableId: command.tableId.toString(),
          snapshot,
        }),
        ...relatedUndoSnapshots.map((relatedSnapshot) =>
          createUndoRedoCommand('ApplyFieldSnapshot', {
            baseId: relatedSnapshot.baseId,
            tableId: relatedSnapshot.tableId,
            snapshot: relatedSnapshot.snapshot,
          })
        ),
      ]);
      const redoCommand = createUndoRedoCommand('DeleteField', {
        baseId: command.baseId.toString(),
        tableId: command.tableId.toString(),
        fieldId: command.fieldId.toString(),
      });

      if (!command.skipUndoRedo()) {
        yield* await handler.undoRedoService.recordEntry(context, updateResult.table.id(), {
          undoCommand,
          redoCommand,
        });
      }

      return ok(
        DeleteFieldResult.create(updateResult.table, updateResult.events, undoCommand, redoCommand)
      );
    });
  }

  private async executeDeletionEntityCleanup(
    context: ExecutionContextPort.IExecutionContext,
    sourceTable: Table,
    previousSourceTable: Table,
    deletedField: Field
  ): Promise<
    Result<
      {
        sourceTable: Table;
        events: ReadonlyArray<IDomainEvent>;
      },
      DomainError
    >
  > {
    const handler = this;
    return safeTry<
      {
        sourceTable: Table;
        events: ReadonlyArray<IDomainEvent>;
      },
      DomainError
    >(async function* () {
      const allTablesSpec = yield* TableAggregate.specs(sourceTable.baseId()).build();
      const allTables = yield* await handler.tableRepository.find(context, allTablesSpec);
      const orderedTables = [
        sourceTable,
        ...allTables.filter((table) => !table.id().equals(sourceTable.id())),
      ];

      let latestSourceTable = sourceTable;
      const events: IDomainEvent[] = [];

      for (const table of orderedTables) {
        const candidateTable = table.id().equals(latestSourceTable.id())
          ? latestSourceTable
          : table;

        const cleanupSpecResult = handler.buildDeletionCleanupSpecs(candidateTable, deletedField, {
          table: candidateTable,
          sourceTable: latestSourceTable,
          previousSourceTable,
        });
        if (cleanupSpecResult.isErr()) return err(cleanupSpecResult.error);
        const cleanupSpec = cleanupSpecResult.value;
        if (!cleanupSpec) {
          continue;
        }
        const updateResult = yield* await handler.tableUpdateFlow.execute(
          context,
          { table: candidateTable },
          (table) => {
            const updated = cleanupSpec.mutate(table);
            if (updated.isErr()) return err(updated.error);
            return ok(TableUpdateResult.create(updated.value, cleanupSpec));
          },
          { publishEvents: false }
        );
        if (candidateTable.id().equals(latestSourceTable.id())) {
          latestSourceTable = updateResult.table;
        }
        events.push(...updateResult.events);
      }

      return ok({
        sourceTable: latestSourceTable,
        events,
      });
    });
  }

  private async captureRelatedUndoSnapshots(
    context: ExecutionContextPort.IExecutionContext,
    sourceTable: Table,
    deletedField: Field
  ): Promise<
    Result<
      ReadonlyArray<{
        baseId: string;
        tableId: string;
        snapshot: UndoRedoFieldSnapshot;
      }>,
      DomainError
    >
  > {
    const handler = this;
    return safeTry(async function* () {
      const allTablesSpec = yield* TableAggregate.specs(sourceTable.baseId()).build();
      const allTables = yield* await handler.tableRepository.find(context, allTablesSpec);
      const orderedTables = [
        sourceTable,
        ...allTables.filter((table) => !table.id().equals(sourceTable.id())),
      ];
      const relatedSnapshots: Array<{
        baseId: string;
        tableId: string;
        snapshot: UndoRedoFieldSnapshot;
      }> = [];

      for (const candidateTable of orderedTables) {
        const cleanupSpecResult = handler.buildDeletionCleanupSpecs(candidateTable, deletedField, {
          table: candidateTable,
          sourceTable,
          previousSourceTable: sourceTable,
        });
        if (cleanupSpecResult.isErr()) {
          return err(cleanupSpecResult.error);
        }

        const relatedFieldIds = new Map(
          flattenAndSpecs(cleanupSpecResult.value)
            .filter(
              (
                spec
              ): spec is
                | TableUpdateFieldHasErrorSpec
                | UpdateLinkConfigSpec
                | TableUpdateFieldTypeSpec =>
                spec instanceof TableUpdateFieldHasErrorSpec ||
                spec instanceof UpdateLinkConfigSpec ||
                spec instanceof TableUpdateFieldTypeSpec
            )
            .map((spec) => {
              const fieldId =
                spec instanceof TableUpdateFieldTypeSpec ? spec.oldField().id() : spec.fieldId();
              return [fieldId.toString(), fieldId] as const;
            })
        );

        for (const relatedFieldId of relatedFieldIds.values()) {
          const snapshot = yield* await handler.fieldUndoRedoSnapshotService.capture(
            context,
            candidateTable,
            relatedFieldId,
            { includeRecords: false }
          );
          relatedSnapshots.push({
            baseId: candidateTable.baseId().toString(),
            tableId: candidateTable.id().toString(),
            snapshot,
          });
        }
      }

      return ok(relatedSnapshots);
    });
  }

  private buildDeletionCleanupSpecs(
    candidateTable: Table,
    deletedField: Field,
    context: FieldDeletionContext
  ): Result<ISpecification<Table, ITableSpecVisitor> | undefined, DomainError> {
    const specs: Array<ISpecification<Table, ITableSpecVisitor>> = [];

    for (const view of candidateTable.views()) {
      if (!implementsOnTeableViewFieldDeleted(view)) {
        continue;
      }
      const result = view.onFieldDeleted(deletedField, context);
      if (result.isErr()) return err(result.error);
      if (result.value?.columnMeta) {
        specs.push(
          TableUpdateViewColumnMetaSpec.create([
            {
              viewId: result.value.viewId,
              fieldId: result.value.fieldId,
              columnMeta: result.value.columnMeta,
            },
          ])
        );
      }
      if (result.value?.queryDefaults) {
        specs.push(
          TableUpdateViewQueryDefaultsSpec.create([
            {
              viewId: result.value.viewId,
              queryDefaults: result.value.queryDefaults,
            },
          ])
        );
      }
    }

    for (const field of candidateTable.getFields()) {
      if (!implementsOnTeableFieldDeleted(field)) {
        continue;
      }
      const result = field.onFieldDeleted(deletedField, context);
      if (result.isErr()) return err(result.error);
      if (result.value) {
        specs.push(result.value);
      }
    }

    return ok(composeAndSpecsOrUndefined(specs));
  }
}
