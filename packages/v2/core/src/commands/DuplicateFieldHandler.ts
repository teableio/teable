import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { FieldOperationPluginRunner } from '../application/services/FieldOperationPluginRunner';
import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { UndoRedoService } from '../application/services/UndoRedoService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Field } from '../domain/table/fields/Field';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkForeignTableReferenceVisitor } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { FieldOperationKind, FieldOperationTargetKind } from '../ports/FieldOperationPlugin';
import { ITableRepository } from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { createUndoRedoCommand } from '../ports/UndoRedoStore';
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
    private readonly fieldCreationSideEffectService: FieldCreationSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.fieldOperationPluginRunner)
    private readonly fieldOperationPluginRunner: FieldOperationPluginRunner,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoService: UndoRedoService,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DuplicateFieldCommand
  ): Promise<Result<DuplicateFieldResult, DomainError>> {
    const handler = this;
    return safeTry<DuplicateFieldResult, DomainError>(async function* () {
      const sourceTable = yield* await handler.loadSourceTable(context, command.tableId);
      const loadedSourceField = yield* sourceTable.getField((field) =>
        field.id().equals(command.fieldId)
      );
      const foreignTableReferences = yield* loadedSourceField.accept(
        new LinkForeignTableReferenceVisitor()
      );
      const foreignTables =
        foreignTableReferences.length === 0
          ? []
          : yield* await handler.foreignTableLoaderService.load(context, {
              references: foreignTableReferences,
            });
      const basePluginContext = {
        kind: FieldOperationKind.duplicate,
        executionContext: context,
        table: sourceTable,
        target: {
          kind: FieldOperationTargetKind.direct,
          sourceOperation: FieldOperationKind.duplicate,
          sourceTable: sourceTable,
        },
        payload: {
          fieldId: command.fieldId,
          sourceField: loadedSourceField,
          foreignTables,
          includeRecordValues: command.includeRecordValues,
          newFieldName: command.newFieldName,
          viewId: command.viewId?.toString(),
        },
        isTransactionBound: false,
      } as const;
      const pluginExecution =
        yield* await handler.fieldOperationPluginRunner.prepare(basePluginContext);
      yield* await pluginExecution.guard();

      let newField: Field | undefined;
      let sourceFieldForResult: Field | undefined;

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
            sourceFieldForResult = field;

            // Generate new field ID
            const newFieldId = yield* FieldId.generate();

            // Generate new field name
            const existingNames = table.getFields().map((f) => f.name().toString());
            const baseName = command.newFieldName ?? `${field.name().toString()} (copy)`;
            const resolvedName = generateUniqueName(baseName, existingNames);
            const newFieldName = yield* FieldName.create(resolvedName);

            // Update table with duplicated field
            // Note: Value duplication happens in the repository visitor (TableSchemaUpdateVisitor)
            // when it visits the TableDuplicateFieldSpec
            const updated = yield* table.update((mutator) =>
              mutator.duplicateField(field, newFieldId, newFieldName, command.includeRecordValues, {
                targetViewId: command.viewId,
                foreignTables,
              })
            );
            const duplicatedFieldResult = updated.table.getField((f) => f.id().equals(newFieldId));
            if (duplicatedFieldResult.isErr()) {
              return err(duplicatedFieldResult.error);
            }
            newField = duplicatedFieldResult.value;
            return ok(updated);
          }),
        {
          hooks: {
            prepare: async (transactionContext, updatedTable) => {
              if (!newField || !sourceFieldForResult) {
                return err(domainError.unexpected({ message: 'Field not created' }));
              }

              const beforePersistResult = await pluginExecution.beforePersist(transactionContext, {
                ...basePluginContext,
                executionContext: transactionContext,
                table: updatedTable,
                result: {
                  sourceField: sourceFieldForResult,
                  duplicatedField: newField,
                },
                isTransactionBound: true,
              });
              if (beforePersistResult.isErr()) {
                return err(beforePersistResult.error);
              }

              return ok([]);
            },
            afterPersist: async (transactionContext, updatedTable) =>
              safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
                if (!newField || !loadedSourceField) {
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

      if (!newField || !sourceFieldForResult) {
        return err(domainError.unexpected({ message: 'Field not created' }));
      }

      const snapshot = yield* await handler.fieldUndoRedoSnapshotService.capture(
        context,
        updateResult.table,
        newField.id(),
        { includeRecords: command.includeRecordValues }
      );
      yield* await handler.undoRedoService.recordEntry(context, updateResult.table.id(), {
        undoCommand: createUndoRedoCommand('DeleteField', {
          baseId: command.baseId.toString(),
          tableId: command.tableId.toString(),
          fieldId: newField.id().toString(),
        }),
        redoCommand: createUndoRedoCommand('ApplyFieldSnapshot', {
          baseId: command.baseId.toString(),
          tableId: command.tableId.toString(),
          snapshot,
        }),
      });
      await pluginExecution.afterCommit({
        ...basePluginContext,
        table: updateResult.table,
        result: {
          sourceField: sourceFieldForResult,
          duplicatedField: newField,
        },
      });

      return ok(
        DuplicateFieldResult.create(
          updateResult.table,
          sourceFieldForResult,
          newField,
          updateResult.events
        )
      );
    });
  }

  private async loadSourceTable(
    context: ExecutionContextPort.IExecutionContext,
    tableId: DuplicateFieldCommand['tableId']
  ): Promise<Result<Table, DomainError>> {
    const whereSpec = TableAggregate.specs().byId(tableId).build();
    if (whereSpec.isErr()) {
      return err(whereSpec.error);
    }
    return this.tableRepository.findOne(context, whereSpec.value);
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
