import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  type FieldDeletionPreparation,
  FieldDeletionPreparationService,
} from '../application/services/FieldDeletionPreparationService';
import { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import {
  FieldOperationPluginRunner,
  type FieldOperationPluginExecution,
} from '../application/services/FieldOperationPluginRunner';
import { prepareFieldOperationSideEffectPlugins } from '../application/services/FieldOperationSideEffectPluginSupport';
import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Field } from '../domain/table/fields/Field';
import type { FieldId } from '../domain/table/fields/FieldId';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import type {
  IFieldDeleteSnapshotSink,
  IFieldDeleteSnapshotSinkCompletion,
} from '../ports/FieldDeleteSnapshotSink';
import {
  FieldOperationKind,
  FieldOperationTargetKind,
  type IFieldOperationDeleteContext,
} from '../ports/FieldOperationPlugin';
import type { ITableRepository } from '../ports/TableRepository';
import {
  NoopTableSchemaCoordination,
  type ITableSchemaCoordination,
} from '../ports/TableSchemaCoordination';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import {
  composeUndoRedoCommands,
  createUndoRedoCommand,
  type UndoRedoFieldSnapshot,
  type UndoRedoCommandLeafData,
} from '../ports/UndoRedoStore';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteFieldsCommand } from './DeleteFieldsCommand';

export class DeleteFieldsResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): DeleteFieldsResult {
    return new DeleteFieldsResult(table, [...events]);
  }
}

@CommandHandler(DeleteFieldsCommand)
@injectable()
export class DeleteFieldsHandler implements ICommandHandler<
  DeleteFieldsCommand,
  DeleteFieldsResult
> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldDeletionSideEffectService)
    private readonly fieldDeletionSideEffectService: FieldDeletionSideEffectService,
    @inject(v2CoreTokens.fieldDeletionPreparationService)
    private readonly fieldDeletionPreparationService: FieldDeletionPreparationService,
    @inject(v2CoreTokens.fieldOperationPluginRunner)
    private readonly fieldOperationPluginRunner: FieldOperationPluginRunner,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.fieldDeleteSnapshotSink)
    private readonly fieldDeleteSnapshotSink: IFieldDeleteSnapshotSink,
    @inject(v2CoreTokens.tableSchemaCoordination)
    private readonly tableSchemaCoordination: ITableSchemaCoordination = new NoopTableSchemaCoordination()
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteFieldsCommand
  ): Promise<Result<DeleteFieldsResult, DomainError>> {
    const leaseResult = await this.tableSchemaCoordination.acquire(
      context,
      [command.tableId.toString()],
      'exclusive'
    );
    if (leaseResult.isErr()) {
      return err(leaseResult.error);
    }
    const lease = leaseResult.value;
    try {
      return await this.execute(context, command);
    } finally {
      await lease.release();
    }
  }

  private async execute(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteFieldsCommand
  ): Promise<Result<DeleteFieldsResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<DeleteFieldsResult, DomainError>(async function* () {
      const events: IDomainEvent[] = [];
      const targetFieldIds = new Set(command.fieldIds.map((fieldId) => fieldId.toString()));
      const relatedUndoSnapshotKeys = new Set<string>();
      const targetUndoLeaves: UndoRedoCommandLeafData[] = [];
      const relatedUndoLeaves: UndoRedoCommandLeafData[] = [];

      const tableSpec = yield* TableAggregate.specs(command.baseId).byId(command.tableId).build();
      const initialTable = yield* await handler.tableRepository.findOne(context, tableSpec);
      const targetFields = yield* handler.resolveTargetFields(initialTable, command.fieldIds);
      const preparation = yield* await handler.fieldDeletionPreparationService.prepare(
        context,
        {
          baseId: command.baseId,
          tableId: command.tableId,
          fieldIds: command.fieldIds,
        },
        { table: initialTable }
      );

      const targetSnapshots = yield* await handler.fieldUndoRedoSnapshotService.captureMany(
        context,
        initialTable,
        command.fieldIds
      );
      for (const snapshot of targetSnapshots) {
        targetUndoLeaves.push(
          createUndoRedoCommand('ApplyFieldSnapshot', {
            baseId: command.baseId.toString(),
            tableId: command.tableId.toString(),
            snapshot,
          })
        );
      }
      let fieldDeleteSnapshotCompletion: IFieldDeleteSnapshotSinkCompletion | undefined;
      if (context.undoRedo?.mode == null) {
        fieldDeleteSnapshotCompletion = yield* await handler.fieldDeleteSnapshotSink.prepare(
          context,
          {
            baseId: command.baseId.toString(),
            tableId: command.tableId.toString(),
            fieldIds: command.fieldIds.map((fieldId) => fieldId.toString()),
            snapshots: targetSnapshots.map((snapshot) => ({
              table: initialTable,
              snapshot,
            })),
          }
        );
      }

      const relatedUndoSnapshots = yield* await handler.captureRelatedUndoSnapshots(
        context,
        preparation
      );
      for (const relatedSnapshot of relatedUndoSnapshots) {
        const snapshotFieldId = relatedSnapshot.snapshot.field.id;
        if (targetFieldIds.has(snapshotFieldId)) {
          continue;
        }
        const snapshotKey = `${relatedSnapshot.baseId}:${relatedSnapshot.tableId}:${snapshotFieldId}`;
        if (relatedUndoSnapshotKeys.has(snapshotKey)) {
          continue;
        }
        relatedUndoSnapshotKeys.add(snapshotKey);
        relatedUndoLeaves.push(
          createUndoRedoCommand('ApplyFieldSnapshot', {
            baseId: relatedSnapshot.baseId,
            tableId: relatedSnapshot.tableId,
            snapshot: relatedSnapshot.snapshot,
          })
        );
      }

      const foreignTables = preparation.foreignTables;
      const plannedSideEffects = preparation.sideEffects.sideEffects;
      const sideEffectPluginExecution = yield* await prepareFieldOperationSideEffectPlugins({
        runner: handler.fieldOperationPluginRunner,
        executionContext: context,
        sourceOperation: FieldOperationKind.delete,
        sourceTable: initialTable,
        foreignTables,
        sideEffects: plannedSideEffects,
      });

      const pluginContexts: IFieldOperationDeleteContext[] = targetFields.map((targetField) => ({
        kind: FieldOperationKind.delete,
        executionContext: context,
        table: initialTable,
        target: {
          kind: FieldOperationTargetKind.direct,
          sourceOperation: FieldOperationKind.delete,
          sourceTable: initialTable,
        },
        payload: {
          fieldId: targetField.id(),
          targetField,
          foreignTables,
          skipUndoRedo: true,
        },
        isTransactionBound: false,
      }));

      const pluginExecutions: FieldOperationPluginExecution[] = [];
      for (const pluginContext of pluginContexts) {
        const pluginExecution =
          yield* await handler.fieldOperationPluginRunner.prepare(pluginContext);
        yield* await pluginExecution.guard();
        pluginExecutions.push(pluginExecution);
      }
      yield* await sideEffectPluginExecution.guard();

      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { table: initialTable },
        (candidate) =>
          candidate.update((mutator) => {
            let nextMutator = mutator;
            for (const fieldId of command.fieldIds) {
              nextMutator = nextMutator.removeField(fieldId);
            }
            return nextMutator;
          }),
        {
          hooks: {
            prepare: async (transactionContext, updatedTable) => {
              for (const [index, pluginExecution] of pluginExecutions.entries()) {
                const beforePersistResult = await pluginExecution.beforePersist(
                  transactionContext,
                  {
                    ...pluginContexts[index]!,
                    executionContext: transactionContext,
                    table: updatedTable,
                    result: {
                      deletedField: targetFields[index]!,
                    },
                    isTransactionBound: true,
                  }
                );
                if (beforePersistResult.isErr()) {
                  return err(beforePersistResult.error);
                }
              }
              const sideEffectBeforePersistResult =
                await sideEffectPluginExecution.beforePersist(transactionContext);
              if (sideEffectBeforePersistResult.isErr()) {
                return err(sideEffectBeforePersistResult.error);
              }
              return ok([]);
            },
            afterPersist: async (transactionContext, updatedTable) =>
              safeTry<{ events: ReadonlyArray<IDomainEvent>; table: Table }, DomainError>(
                async function* () {
                  const sideEffectResult =
                    yield* await handler.fieldDeletionSideEffectService.execute(
                      transactionContext,
                      {
                        table: updatedTable,
                        fields: targetFields,
                        foreignTables,
                      },
                      preparation.sideEffects
                    );

                  const cleanupResult = yield* await handler.executeDeletionEntityCleanups(
                    transactionContext,
                    updatedTable,
                    sideEffectResult.appliedDeletions,
                    preparation
                  );
                  const cleanupEvents: IDomainEvent[] = [...cleanupResult.events];

                  return ok({
                    events: [...sideEffectResult.events, ...cleanupEvents],
                    table: cleanupResult.sourceTable,
                  });
                }
              ),
          },
        }
      );

      if (fieldDeleteSnapshotCompletion) {
        yield* await fieldDeleteSnapshotCompletion.complete(context);
      }

      events.push(...updateResult.events);

      const redoLeaves = command.fieldIds.map((fieldId) =>
        createUndoRedoCommand('DeleteField', {
          baseId: command.baseId.toString(),
          tableId: command.tableId.toString(),
          fieldId: fieldId.toString(),
        })
      );

      yield* await handler.undoRedoStackService.appendEntry(
        toUndoRedoStackAppendContext(context),
        updateResult.table.id(),
        {
          undoCommand: composeUndoRedoCommands([...targetUndoLeaves, ...relatedUndoLeaves]),
          redoCommand: composeUndoRedoCommands(redoLeaves),
        }
      );

      for (const [index, pluginExecution] of pluginExecutions.entries()) {
        await pluginExecution.afterCommit({
          ...pluginContexts[index]!,
          table: updateResult.table,
          result: {
            deletedField: targetFields[index]!,
          },
        });
      }
      await sideEffectPluginExecution.afterCommit();

      return ok(DeleteFieldsResult.create(updateResult.table, events));
    });
  }

  private resolveTargetFields(
    table: Table,
    fieldIds: ReadonlyArray<FieldId>
  ): Result<ReadonlyArray<Field>, DomainError> {
    const fields: Field[] = [];
    for (const fieldId of fieldIds) {
      const targetField = table.getFields((field) => field.id().equals(fieldId))[0];
      if (!targetField) {
        return err(domainError.notFound({ message: 'Field not found' }));
      }
      fields.push(targetField);
    }
    return ok(fields);
  }

  private async executeDeletionEntityCleanups(
    context: ExecutionContextPort.IExecutionContext,
    sourceTable: Table,
    appliedDeletions: ReadonlyArray<{ readonly table: Table; readonly deletedField: Field }>,
    preparation: FieldDeletionPreparation
  ): Promise<
    Result<
      { readonly sourceTable: Table; readonly events: ReadonlyArray<IDomainEvent> },
      DomainError
    >
  > {
    const handler = this;
    return safeTry(async function* () {
      const tablesById = new Map(preparation.tablesBeforeDeletionById);
      tablesById.set(sourceTable.id().toString(), sourceTable);
      for (const appliedDeletion of appliedDeletions) {
        tablesById.set(appliedDeletion.table.id().toString(), appliedDeletion.table);
      }
      const events: IDomainEvent[] = [];
      for (const cleanup of preparation.cleanup) {
        const table = tablesById.get(cleanup.tableId);
        if (!table) {
          return err(
            domainError.notFound({
              code: 'field.delete.cleanup_table_missing',
              message: 'Field deletion cleanup table not found',
            })
          );
        }
        const updateResult = yield* await handler.tableUpdateFlow.execute(
          context,
          { table },
          (candidate) => candidate.update((mutator) => mutator.applySpecs([cleanup.spec])),
          { publishEvents: false }
        );
        tablesById.set(cleanup.tableId, updateResult.table);
        events.push(...updateResult.events, ...updateResult.postPersistEvents);
      }
      return ok({
        sourceTable: tablesById.get(sourceTable.id().toString()) ?? sourceTable,
        events,
      });
    });
  }

  private async captureRelatedUndoSnapshots(
    context: ExecutionContextPort.IExecutionContext,
    preparation: FieldDeletionPreparation
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
      const relatedSnapshots: Array<{
        baseId: string;
        tableId: string;
        snapshot: UndoRedoFieldSnapshot;
      }> = [];
      const captured = new Set<string>();
      for (const effect of preparation.snapshotFields) {
        const key = `${effect.tableId}:${effect.fieldId}`;
        if (captured.has(key)) continue;
        captured.add(key);
        const table = preparation.tablesBeforeDeletionById.get(effect.tableId);
        if (!table) {
          return err(
            domainError.notFound({
              code: 'field.delete.snapshot_table_missing',
              message: 'Field deletion snapshot table not found',
            })
          );
        }
        const field = yield* table.getField(
          (candidate) => candidate.id().toString() === effect.fieldId
        );
        const snapshot = yield* await handler.fieldUndoRedoSnapshotService.capture(
          context,
          table,
          field.id(),
          { includeRecords: false }
        );
        relatedSnapshots.push({
          baseId: table.baseId().toString(),
          tableId: effect.tableId,
          snapshot,
        });
      }
      return ok(relatedSnapshots);
    });
  }
}
