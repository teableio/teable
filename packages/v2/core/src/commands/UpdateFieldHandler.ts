import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldOperationPluginRunner } from '../application/services/FieldOperationPluginRunner';
import {
  collectFieldUpdateAddSideEffects,
  prepareFieldAddSideEffectPlugins,
} from '../application/services/FieldOperationSideEffectPluginSupport';
import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { FieldUpdateSideEffectService } from '../application/services/FieldUpdateSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import type { BaseId } from '../domain/base/BaseId';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import type { Field } from '../domain/table/fields/Field';
import type { FieldId } from '../domain/table/fields/FieldId';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { TableUpdateFieldTypeSpec } from '../domain/table/specs/TableUpdateFieldTypeSpec';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import type { TableId } from '../domain/table/TableId';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { FieldOperationKind, FieldOperationTargetKind } from '../ports/FieldOperationPlugin';
import { type ITableMapper } from '../ports/mappers/TableMapper';
import { ITableRepository } from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { createUndoRedoCommand } from '../ports/UndoRedoStore';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { buildUpdateFieldSpecs } from './TableFieldUpdateSpecs';
import { UpdateFieldCommand } from './UpdateFieldCommand';

export class UpdateFieldResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): UpdateFieldResult {
    return new UpdateFieldResult(table, [...events]);
  }
}

@CommandHandler(UpdateFieldCommand)
@injectable()
export class UpdateFieldHandler implements ICommandHandler<UpdateFieldCommand, UpdateFieldResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: ITableMapper,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldUpdateSideEffectService)
    private readonly fieldUpdateSideEffectService: FieldUpdateSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.fieldOperationPluginRunner)
    private readonly fieldOperationPluginRunner: FieldOperationPluginRunner,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService
  ) {}

  private hasTypeConversion(
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    fieldId: FieldId
  ): boolean {
    const targetFieldId = fieldId.toString();
    return specs.some(
      (spec) =>
        spec instanceof TableUpdateFieldTypeSpec &&
        spec.isTypeConversion() &&
        spec.newField().id().toString() === targetFieldId
    );
  }

  private ensureFieldDbFieldName(
    field: Field,
    fallbackDbFieldName?: string
  ): Result<void, DomainError> {
    if (field.dbFieldName().isOk()) {
      return ok(undefined);
    }

    const candidate = fallbackDbFieldName ?? field.id().toString();
    return DbFieldName.rehydrate(candidate).andThen((dbFieldName) =>
      field.setDbFieldName(dbFieldName)
    );
  }

  private ensureTypeConversionSpecDbFieldNames(
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    fallbackDbFieldName?: string
  ): Result<void, DomainError> {
    for (const spec of specs) {
      if (!(spec instanceof TableUpdateFieldTypeSpec)) {
        continue;
      }

      const oldFieldResult = this.ensureFieldDbFieldName(spec.oldField(), fallbackDbFieldName);
      if (oldFieldResult.isErr()) {
        return err(oldFieldResult.error);
      }

      const newFieldResult = this.ensureFieldDbFieldName(spec.newField(), fallbackDbFieldName);
      if (newFieldResult.isErr()) {
        return err(newFieldResult.error);
      }
    }

    return ok(undefined);
  }

  /**
   * Extract foreign table references from an existing field's config.
   * Used to ensure foreign tables are loaded even when update payload doesn't include config.
   */
  private extractForeignTableReferencesFromField(
    field: Field
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const references: LinkForeignTableReference[] = [];
    const fieldType = field.type().toString();

    // For ConditionalRollupField and RollupField, check config for foreignTableId
    if (fieldType === 'conditionalRollup' || fieldType === 'rollup') {
      // These fields have a config() method that returns config with foreignTableId() method
      const fieldWithConfig = field as unknown as {
        config(): { foreignTableId(): TableId; baseId?: BaseId };
      };
      const config = fieldWithConfig.config();
      const foreignTableId = config.foreignTableId();
      if (foreignTableId) {
        references.push({
          foreignTableId,
          baseId: config.baseId,
        });
      }
    }

    // For LookupField and LinkField, access foreignTableId() directly on the field
    if (fieldType === 'lookup' || fieldType === 'link') {
      const fieldWithForeignTable = field as unknown as {
        foreignTableId(): TableId;
        baseId?(): BaseId;
      };
      const foreignTableId = fieldWithForeignTable.foreignTableId();
      if (foreignTableId) {
        references.push({
          foreignTableId,
          baseId: fieldWithForeignTable.baseId?.(),
        });
      }
    }

    return ok(references);
  }

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: UpdateFieldCommand
  ): Promise<Result<UpdateFieldResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateFieldResult, DomainError>(async function* () {
      // 1. Load the table first to access existing field config
      const whereSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const tableResult = await handler.tableRepository.findOne(context, whereSpec);
      if (tableResult.isErr()) {
        if (isNotFoundError(tableResult.error)) {
          return err(
            domainError.notFound({
              code: 'table.not_found',
              message: 'Table not found',
            })
          );
        }
        return err(tableResult.error);
      }
      const table = tableResult.value;

      // 2. Get the existing field to extract foreign table references
      const fieldResult = table.getField((f) => f.id().equals(command.fieldId));
      if (fieldResult.isErr()) {
        return err(fieldResult.error);
      }
      const existingField = fieldResult.value;

      // 3. Extract foreign table references from both command and existing field
      const commandReferences = yield* command.foreignTableReferences();
      const existingReferences =
        yield* handler.extractForeignTableReferencesFromField(existingField);

      // Merge references, avoiding duplicates
      const allReferences = [...commandReferences];
      for (const ref of existingReferences) {
        if (!allReferences.some((r) => r.foreignTableId.equals(ref.foreignTableId))) {
          allReferences.push(ref);
        }
      }

      // 4. Load foreign tables
      const foreignTables = yield* await handler.foreignTableLoaderService.load(context, {
        references: allReferences,
      });

      // 5. Build update specs once. Preview planning runs on a detached clone so the live table
      // stays clean for undo snapshots, plugin checks, and the real update execution.
      const previousField: Field = existingField;
      const updateSpecsResult = buildUpdateFieldSpecs(existingField, command.fieldUpdate, {
        hostTable: table,
        foreignTables,
        executionContext: context,
      });
      if (updateSpecsResult.isErr()) return err(updateSpecsResult.error);
      const updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>> =
        updateSpecsResult.value;
      yield* handler.ensureTypeConversionSpecDbFieldNames(updateSpecs);
      const hasTypeConversion = handler.hasTypeConversion(updateSpecs, command.fieldId);
      if (updateSpecs.length === 0) {
        if (!command.allowNoop) {
          return err(domainError.validation({ message: 'No changes to apply' }));
        }
        return ok(UpdateFieldResult.create(table, []));
      }

      const oldFieldSnapshot = yield* await handler.fieldUndoRedoSnapshotService.capture(
        context,
        table,
        command.fieldId,
        { includeRecords: hasTypeConversion }
      );
      const previewTable = yield* table.clone(handler.tableMapper);
      const previewPreviousField = yield* previewTable.getField((f) =>
        f.id().equals(command.fieldId)
      );
      const previewUpdateResult = yield* previewTable.update((mutator) =>
        mutator.updateField(command.fieldId, updateSpecs, { foreignTables })
      );
      const previewUpdatedField = yield* previewUpdateResult.table.getField((f) =>
        f.id().equals(command.fieldId)
      );
      const plannedSideEffects = yield* collectFieldUpdateAddSideEffects(
        previewTable,
        previewUpdatedField,
        previewPreviousField,
        foreignTables
      );

      const basePluginContext = {
        kind: FieldOperationKind.update,
        executionContext: context,
        table,
        target: {
          kind: FieldOperationTargetKind.direct,
          sourceOperation: FieldOperationKind.update,
          sourceTable: table,
        },
        payload: {
          fieldId: command.fieldId,
          fieldUpdate: command.fieldUpdate,
          previousField,
          updateSpecs,
          foreignTables,
          allowNoop: command.allowNoop,
        },
        isTransactionBound: false,
      } as const;
      const pluginExecution =
        yield* await handler.fieldOperationPluginRunner.prepare(basePluginContext);
      const sideEffectPluginExecution = yield* await prepareFieldAddSideEffectPlugins({
        runner: handler.fieldOperationPluginRunner,
        executionContext: context,
        sourceOperation: FieldOperationKind.update,
        sourceTable: table,
        foreignTables,
        sideEffects: plannedSideEffects,
      });
      yield* await pluginExecution.guard();
      yield* await sideEffectPluginExecution.guard();

      // 6. Execute update flow with the already-loaded table
      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { table }, // Pass the already-loaded table to avoid reloading
        (tableToUpdate) =>
          tableToUpdate.update((mutator) =>
            mutator.updateField(command.fieldId, updateSpecs, { foreignTables })
          ),
        {
          hooks: {
            prepare: async (transactionContext, updatedTable) =>
              safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
                const effectiveUpdatedField = yield* updatedTable.getField((f) =>
                  f.id().equals(command.fieldId)
                );

                const beforePersistResult = await pluginExecution.beforePersist(
                  transactionContext,
                  {
                    ...basePluginContext,
                    executionContext: transactionContext,
                    table: updatedTable,
                    result: {
                      updatedField: effectiveUpdatedField,
                    },
                    isTransactionBound: true,
                  }
                );
                if (beforePersistResult.isErr()) {
                  return err(beforePersistResult.error);
                }

                const sideEffectBeforePersistResult =
                  await sideEffectPluginExecution.beforePersist(transactionContext);
                if (sideEffectBeforePersistResult.isErr()) {
                  return err(sideEffectBeforePersistResult.error);
                }

                const prepareEvents = yield* await handler.fieldUpdateSideEffectService.prepare(
                  transactionContext,
                  {
                    table: updatedTable,
                    updatedField: effectiveUpdatedField,
                    previousField,
                    updateSpecs,
                    foreignTables,
                  }
                );

                return ok([...prepareEvents]);
              }),
            afterPersist: async (transactionContext, updatedTable) =>
              safeTry<{ events: ReadonlyArray<IDomainEvent>; table: Table }, DomainError>(
                async function* () {
                  const effectiveUpdatedField = yield* updatedTable.getField((f) =>
                    f.id().equals(command.fieldId)
                  );

                  const allEvents: IDomainEvent[] = [];
                  const sideEffectResult =
                    yield* await handler.fieldUpdateSideEffectService.execute(transactionContext, {
                      table: updatedTable,
                      updatedField: effectiveUpdatedField,
                      previousField,
                      updateSpecs,
                      foreignTables,
                    });
                  allEvents.push(...sideEffectResult.events);

                  return ok({ events: allEvents, table: sideEffectResult.updatedTable });
                }
              ),
          },
        }
      );

      const newFieldSnapshot = yield* await handler.fieldUndoRedoSnapshotService.capture(
        context,
        updateResult.table,
        command.fieldId,
        { includeRecords: hasTypeConversion }
      );
      yield* await handler.undoRedoStackService.appendEntry(
        toUndoRedoStackAppendContext(context),
        updateResult.table.id(),
        {
          undoCommand: createUndoRedoCommand(
            hasTypeConversion ? 'ReplayFieldTypeConversion' : 'ApplyFieldSnapshot',
            {
              baseId: table.baseId().toString(),
              tableId: table.id().toString(),
              snapshot: oldFieldSnapshot,
            }
          ),
          redoCommand: createUndoRedoCommand(
            hasTypeConversion ? 'ReplayFieldTypeConversion' : 'ApplyFieldSnapshot',
            {
              baseId: updateResult.table.baseId().toString(),
              tableId: updateResult.table.id().toString(),
              snapshot: newFieldSnapshot,
            }
          ),
        }
      );

      const updatedFieldForPlugin = yield* updateResult.table.getField((f) =>
        f.id().equals(command.fieldId)
      );
      await pluginExecution.afterCommit({
        ...basePluginContext,
        table: updateResult.table,
        result: {
          updatedField: updatedFieldForPlugin,
        },
      });
      await sideEffectPluginExecution.afterCommit();

      return ok(UpdateFieldResult.create(updateResult.table, updateResult.events));
    });
  }
}
