import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import type { IDomainContext } from '../domain/shared/DomainContext';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import type { Field } from '../domain/table/fields/Field';
import type { Table } from '../domain/table/Table';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { composeUndoRedoCommands, createUndoRedoCommand } from '../ports/UndoRedoStore';
import type { ResolvedTableFieldInput } from '../schemas/field';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateFieldsCommand } from './CreateFieldsCommand';
import { parseTableFieldSpec, resolveTableFieldInputName } from './TableFieldSpecs';

type PlannedField = {
  inputIndex: number;
  field: Field;
};

type BuildBatchUpdateResult = {
  updateResult: TableUpdateResult;
  createdFieldsInCreationOrder: ReadonlyArray<Field>;
  createdFieldsInInputOrder: ReadonlyArray<Field>;
};

export class CreateFieldsResult {
  private constructor(
    readonly table: Table,
    readonly fields: ReadonlyArray<Field>,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    table: Table,
    fields: ReadonlyArray<Field>,
    events: ReadonlyArray<IDomainEvent>
  ): CreateFieldsResult {
    return new CreateFieldsResult(table, [...fields], [...events]);
  }
}

@CommandHandler(CreateFieldsCommand)
@injectable()
export class CreateFieldsHandler
  implements ICommandHandler<CreateFieldsCommand, CreateFieldsResult>
{
  constructor(
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldCreationSideEffectService)
    private readonly fieldCreationSideEffectService: FieldCreationSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateFieldsCommand
  ): Promise<Result<CreateFieldsResult, DomainError>> {
    const handler = this;
    return safeTry<CreateFieldsResult, DomainError>(async function* () {
      const foreignTableReferences = yield* command.foreignTableReferences();
      const foreignTables = yield* await handler.foreignTableLoaderService.load(context, {
        references: foreignTableReferences,
      });
      const domainContext = ExecutionContextPort.getDomainContext(context);

      let createdFieldsInCreationOrder: ReadonlyArray<Field> = [];
      let createdFieldsInInputOrder: ReadonlyArray<Field> = [];

      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { baseId: command.baseId, tableId: command.tableId },
        (table) => {
          const batchUpdateResult = handler.buildBatchUpdate(
            table,
            command,
            foreignTables,
            context,
            domainContext
          );
          if (batchUpdateResult.isErr()) {
            return err(batchUpdateResult.error);
          }
          createdFieldsInCreationOrder = batchUpdateResult.value.createdFieldsInCreationOrder;
          createdFieldsInInputOrder = batchUpdateResult.value.createdFieldsInInputOrder;
          return ok(batchUpdateResult.value.updateResult);
        },
        {
          hooks: {
            prepare: async (_transactionContext, updatedTable) => {
              if (!createdFieldsInCreationOrder.length) {
                return ok([]);
              }

              const previewResult = await handler.fieldCreationSideEffectService.preview({
                table: updatedTable,
                fields: createdFieldsInCreationOrder,
                foreignTables,
                domainContext,
              });

              return previewResult.map(() => []);
            },
            afterPersist: async (transactionContext, updatedTable) =>
              safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
                if (!createdFieldsInCreationOrder.length) {
                  return ok([]);
                }

                const sideEffectResult =
                  yield* await handler.fieldCreationSideEffectService.execute(transactionContext, {
                    table: updatedTable,
                    fields: createdFieldsInCreationOrder,
                    foreignTables,
                    domainContext,
                  });

                return ok(sideEffectResult.events);
              }),
          },
        }
      );

      if (!createdFieldsInCreationOrder.length) {
        return err(domainError.unexpected({ message: 'Fields not created' }));
      }

      if (handler.shouldCaptureUndoRedo(context)) {
        const snapshots = [];
        for (const field of createdFieldsInCreationOrder) {
          const snapshot = yield* await handler.fieldUndoRedoSnapshotService.capture(
            context,
            updateResult.table,
            field.id()
          );
          snapshots.push(snapshot);
        }

        const undoCommands = [...createdFieldsInCreationOrder].reverse().map((field) =>
          createUndoRedoCommand('DeleteField', {
            baseId: command.baseId.toString(),
            tableId: command.tableId.toString(),
            fieldId: field.id().toString(),
          })
        );
        const redoCommands = snapshots.map((snapshot) =>
          createUndoRedoCommand('ApplyFieldSnapshot', {
            baseId: command.baseId.toString(),
            tableId: command.tableId.toString(),
            snapshot,
          })
        );

        yield* await handler.undoRedoStackService.appendEntry(
          toUndoRedoStackAppendContext(context),
          updateResult.table.id(),
          {
            undoCommand: composeUndoRedoCommands(undoCommands),
            redoCommand: composeUndoRedoCommands(redoCommands),
          }
        );
      }

      return ok(
        CreateFieldsResult.create(
          updateResult.table,
          createdFieldsInInputOrder,
          updateResult.events
        )
      );
    });
  }

  private shouldCaptureUndoRedo(context: ExecutionContextPort.IExecutionContext): boolean {
    return Boolean(context.windowId) && context.undoRedo?.mode == null;
  }

  private buildBatchUpdate(
    table: Table,
    command: CreateFieldsCommand,
    foreignTables: ReadonlyArray<Table>,
    context: ExecutionContextPort.IExecutionContext,
    domainContext?: IDomainContext
  ): Result<BuildBatchUpdateResult, DomainError> {
    const plannedFieldsResult = this.planFields(
      table,
      command,
      foreignTables,
      context,
      domainContext
    );
    if (plannedFieldsResult.isErr()) {
      return err(plannedFieldsResult.error);
    }

    const updateResult = table.update((mutator) =>
      mutator.addFields(
        plannedFieldsResult.value.map((plannedField) => plannedField.field),
        {
          foreignTables,
          domainContext,
        }
      )
    );
    if (updateResult.isErr()) {
      return err(updateResult.error);
    }

    return this.resolveCreatedFields(updateResult.value.table, plannedFieldsResult.value).map(
      ({ creationOrder, inputOrder }) => ({
        updateResult: updateResult.value,
        createdFieldsInCreationOrder: creationOrder,
        createdFieldsInInputOrder: inputOrder,
      })
    );
  }

  private planFields(
    table: Table,
    command: CreateFieldsCommand,
    foreignTables: ReadonlyArray<Table>,
    context: ExecutionContextPort.IExecutionContext,
    domainContext?: IDomainContext
  ): Result<ReadonlyArray<PlannedField>, DomainError> {
    let currentTable = table;
    const remaining = command.fields.map((field, inputIndex) => ({ field, inputIndex }));
    const planned: PlannedField[] = [];

    while (remaining.length > 0) {
      let progressed = false;
      let deferredError: DomainError | undefined;

      for (let index = 0; index < remaining.length; ) {
        const current = remaining[index]!;
        const attemptResult = this.tryPlanField(
          currentTable,
          current.field,
          command,
          foreignTables,
          context,
          domainContext
        );

        if (attemptResult.isErr()) {
          deferredError ??= attemptResult.error;
          index += 1;
          continue;
        }

        currentTable = attemptResult.value.table;
        planned.push({
          inputIndex: current.inputIndex,
          field: attemptResult.value.field,
        });
        remaining.splice(index, 1);
        progressed = true;
      }

      if (!progressed) {
        return err(
          deferredError ??
            domainError.validation({
              message: 'Unable to resolve CreateFieldsCommand dependencies',
            })
        );
      }
    }

    return ok(planned);
  }

  private tryPlanField(
    table: Table,
    fieldInput: CreateFieldsCommand['fields'][number],
    command: CreateFieldsCommand,
    foreignTables: ReadonlyArray<Table>,
    context: ExecutionContextPort.IExecutionContext,
    domainContext?: IDomainContext
  ): Result<{ table: Table; field: Field }, DomainError> {
    const existingNames = table.getFields().map((field) => field.name().toString());
    return resolveTableFieldInputName(fieldInput, existingNames, {
      t: context.$t,
      hostTable: table,
      foreignTables,
    }).andThen((resolved) => {
      const normalized = this.populateLinkLookupFieldId(resolved, foreignTables);
      return parseTableFieldSpec(normalized, {
        isPrimary: false,
        executionContext: context,
      })
        .andThen((spec) => spec.createField({ baseId: command.baseId, tableId: command.tableId }))
        .andThen((field) => this.applyDbFieldName(field, normalized.dbFieldName))
        .andThen((field) =>
          table
            .addField(field, {
              foreignTables,
              domainContext,
            })
            .andThen((nextTable) =>
              nextTable
                .getField((candidate) => candidate.id().equals(field.id()))
                .map((createdField) => ({
                  table: nextTable,
                  field: createdField,
                }))
            )
        );
    });
  }

  private resolveCreatedFields(
    table: Table,
    plannedFields: ReadonlyArray<PlannedField>
  ): Result<
    { creationOrder: ReadonlyArray<Field>; inputOrder: ReadonlyArray<Field> },
    DomainError
  > {
    const creationOrder: Field[] = [];
    for (const plannedField of plannedFields) {
      const fieldResult = table.getField((field) => field.id().equals(plannedField.field.id()));
      if (fieldResult.isErr()) {
        return err(fieldResult.error);
      }
      creationOrder.push(fieldResult.value);
    }

    const inputOrder = [...plannedFields]
      .sort((left, right) => left.inputIndex - right.inputIndex)
      .map((plannedField) => plannedField.field.id())
      .map((fieldId) => {
        const fieldResult = table.getField((field) => field.id().equals(fieldId));
        if (fieldResult.isErr()) {
          return err(fieldResult.error);
        }
        return ok(fieldResult.value);
      });

    const inputOrderFields: Field[] = [];
    for (const fieldResult of inputOrder) {
      if (fieldResult.isErr()) {
        return err(fieldResult.error);
      }
      inputOrderFields.push(fieldResult.value);
    }

    return ok({
      creationOrder,
      inputOrder: inputOrderFields,
    });
  }

  private populateLinkLookupFieldId(
    field: ResolvedTableFieldInput,
    foreignTables: ReadonlyArray<Table>
  ): ResolvedTableFieldInput {
    if (field.type !== 'link' || field.options.lookupFieldId != null) {
      return field;
    }

    const foreignTable = foreignTables.find(
      (table) => table.id().toString() === field.options.foreignTableId
    );
    if (!foreignTable) {
      return field;
    }

    return {
      ...field,
      options: {
        ...field.options,
        lookupFieldId: foreignTable.primaryFieldId().toString(),
      },
    };
  }

  private applyDbFieldName(
    field: Field,
    rawDbFieldName: string | undefined
  ): Result<Field, DomainError> {
    if (!rawDbFieldName) {
      return ok(field);
    }

    return DbFieldName.rehydrate(rawDbFieldName).andThen((dbFieldName) => {
      const existingDbFieldNameResult = field.dbFieldName().andThen((value) => value.value());

      if (existingDbFieldNameResult.isErr()) {
        return field.setDbFieldName(dbFieldName).map(() => field);
      }

      if (existingDbFieldNameResult.value === rawDbFieldName) {
        return ok(field);
      }

      return field.renameDbFieldName(dbFieldName).map(() => field);
    });
  }
}
