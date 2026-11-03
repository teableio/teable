import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldConversionPreparationService } from '../application/services/FieldConversionPreparationService';
import { FieldOperationPluginRunner } from '../application/services/FieldOperationPluginRunner';
import { prepareFieldOperationSideEffectPlugins } from '../application/services/FieldOperationSideEffectPluginSupport';
import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { FieldUpdateSideEffectService } from '../application/services/FieldUpdateSideEffectService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import type { Field } from '../domain/table/fields/Field';
import type { FieldId } from '../domain/table/fields/FieldId';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { TableUpdateFieldTypeSpec } from '../domain/table/specs/TableUpdateFieldTypeSpec';
import type { Table } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { FieldOperationKind, FieldOperationTargetKind } from '../ports/FieldOperationPlugin';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { createUndoRedoCommand } from '../ports/UndoRedoStore';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
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
    @inject(v2CoreTokens.fieldConversionPreparationService)
    private readonly fieldConversionPreparationService: FieldConversionPreparationService,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldUpdateSideEffectService)
    private readonly fieldUpdateSideEffectService: FieldUpdateSideEffectService,
    @inject(v2CoreTokens.fieldOperationPluginRunner)
    private readonly fieldOperationPluginRunner: FieldOperationPluginRunner,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService
  ) {}

  private isValuePreservingConversion(
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    fieldId: FieldId
  ): boolean {
    const targetFieldId = fieldId.toString();
    return specs.some(
      (spec) =>
        spec instanceof TableUpdateFieldTypeSpec &&
        spec.isValuePreservingConversion() &&
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

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: UpdateFieldCommand
  ): Promise<Result<UpdateFieldResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<UpdateFieldResult, DomainError>(async function* () {
      const preparation = yield* await handler.fieldConversionPreparationService.prepare(
        context,
        command
      );
      const { table, previousField, foreignTables, updateSpecs, plannedSideEffects } = preparation;
      yield* handler.ensureTypeConversionSpecDbFieldNames(updateSpecs);
      const hasTypeConversion = preparation.isTypeConversion;
      // Value-preserving conversions (e.g. singleSelect → text) keep every
      // stored cell verbatim, so materializing the whole column into the
      // undo/redo snapshots would be pure waste: replaying the meta change
      // alone restores the field, and the replay path already skips value
      // writes when a snapshot carries no records.
      const includeSnapshotRecords =
        hasTypeConversion && !handler.isValuePreservingConversion(updateSpecs, command.fieldId);
      if (preparation.isNoop) {
        return ok(UpdateFieldResult.create(table, []));
      }

      const oldFieldSnapshot = yield* await handler.fieldUndoRedoSnapshotService.capture(
        context,
        table,
        command.fieldId,
        { includeRecords: includeSnapshotRecords }
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
      const sideEffectPluginExecution = yield* await prepareFieldOperationSideEffectPlugins({
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
        { includeRecords: includeSnapshotRecords }
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
