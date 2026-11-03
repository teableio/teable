import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  type FieldDeletionPreparation,
  FieldDeletionPreparationService,
} from '../application/services/FieldDeletionPreparationService';
import { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import { FieldOperationPluginRunner } from '../application/services/FieldOperationPluginRunner';
import { prepareFieldOperationSideEffectPlugins } from '../application/services/FieldOperationSideEffectPluginSupport';
import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { Field } from '../domain/table/fields/Field';
import { Table as TableAggregate } from '../domain/table/Table';
import type { Table } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import type {
  IFieldDeleteSnapshotSink,
  IFieldDeleteSnapshotSinkCompletion,
} from '../ports/FieldDeleteSnapshotSink';
import { FieldOperationKind, FieldOperationTargetKind } from '../ports/FieldOperationPlugin';
import * as TableRepositoryPort from '../ports/TableRepository';
import {
  NoopTableSchemaCoordination,
  type ITableSchemaCoordination,
} from '../ports/TableSchemaCoordination';
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
    @inject(v2CoreTokens.fieldDeletionPreparationService)
    private readonly fieldDeletionPreparationService: FieldDeletionPreparationService,
    @inject(v2CoreTokens.fieldOperationPluginRunner)
    private readonly fieldOperationPluginRunner: FieldOperationPluginRunner,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService,
    @inject(v2CoreTokens.fieldDeleteSnapshotSink)
    private readonly fieldDeleteSnapshotSink: IFieldDeleteSnapshotSink,
    @inject(v2CoreTokens.tableSchemaCoordination)
    private readonly tableSchemaCoordination: ITableSchemaCoordination = new NoopTableSchemaCoordination()
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteFieldCommand
  ): Promise<Result<DeleteFieldResult, DomainError>> {
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
    command: DeleteFieldCommand
  ): Promise<Result<DeleteFieldResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
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
      if (!targetField) {
        if (ExecutionContextPort.isUndoRedoReplay(context)) {
          return ok(
            DeleteFieldResult.create(
              table,
              [],
              createUndoRedoCommand('Batch', []),
              createUndoRedoCommand('Batch', [])
            )
          );
        }
        return err(domainError.notFound({ message: 'Field not found' }));
      }
      const preparation = yield* await handler.fieldDeletionPreparationService.prepare(
        context,
        {
          baseId: command.baseId,
          tableId: command.tableId,
          fieldIds: [command.fieldId],
        },
        { table }
      );
      const snapshot = command.skipTargetSnapshot()
        ? undefined
        : yield* await handler.fieldUndoRedoSnapshotService.capture(
            context,
            table,
            command.fieldId
          );
      let fieldDeleteSnapshotCompletion: IFieldDeleteSnapshotSinkCompletion | undefined;
      if (snapshot && !command.skipDeleteSnapshotSink() && context.undoRedo?.mode == null) {
        fieldDeleteSnapshotCompletion = yield* await handler.fieldDeleteSnapshotSink.prepare(
          context,
          {
            baseId: command.baseId.toString(),
            tableId: command.tableId.toString(),
            fieldIds: [command.fieldId.toString()],
            snapshots: [{ table, snapshot }],
          }
        );
      }
      const relatedUndoSnapshots = yield* await handler.captureRelatedUndoSnapshots(
        context,
        preparation
      );

      const foreignTables = preparation.foreignTables;
      const plannedSideEffects = preparation.sideEffects.sideEffects;
      const basePluginContext = {
        kind: FieldOperationKind.delete,
        executionContext: context,
        table,
        target: {
          kind: FieldOperationTargetKind.direct,
          sourceOperation: FieldOperationKind.delete,
          sourceTable: table,
        },
        payload: {
          fieldId: command.fieldId,
          targetField,
          foreignTables,
          skipUndoRedo: command.skipUndoRedo(),
        },
        isTransactionBound: false,
      } as const;
      const pluginExecution =
        yield* await handler.fieldOperationPluginRunner.prepare(basePluginContext);
      const sideEffectPluginExecution = yield* await prepareFieldOperationSideEffectPlugins({
        runner: handler.fieldOperationPluginRunner,
        executionContext: context,
        sourceOperation: FieldOperationKind.delete,
        sourceTable: table,
        foreignTables,
        sideEffects: plannedSideEffects,
      });
      yield* await pluginExecution.guard();
      yield* await sideEffectPluginExecution.guard();

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
            prepare: async (transactionContext, updatedTable) => {
              if (!deletedField) {
                return err(domainError.unexpected({ message: 'Field not deleted' }));
              }

              const beforePersistResult = await pluginExecution.beforePersist(transactionContext, {
                ...basePluginContext,
                executionContext: transactionContext,
                table: updatedTable,
                result: {
                  deletedField,
                },
                isTransactionBound: true,
              });
              if (beforePersistResult.isErr()) {
                return err(beforePersistResult.error);
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
                  if (!deletedField)
                    return err(domainError.unexpected({ message: 'Field not deleted' }));
                  const sideEffectResult =
                    yield* await handler.fieldDeletionSideEffectService.execute(
                      transactionContext,
                      {
                        table: updatedTable,
                        fields: [deletedField],
                        foreignTables,
                      },
                      preparation.sideEffects
                    );

                  const cleanupResult = yield* await handler.executeDeletionEntityCleanup(
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

      const undoCommand = composeUndoRedoCommands([
        ...(snapshot
          ? [
              createUndoRedoCommand('ApplyFieldSnapshot', {
                baseId: command.baseId.toString(),
                tableId: command.tableId.toString(),
                snapshot,
              }),
            ]
          : []),
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
        yield* await handler.undoRedoStackService.appendEntry(
          toUndoRedoStackAppendContext(context),
          updateResult.table.id(),
          {
            undoCommand,
            redoCommand,
          }
        );
      }
      if (!deletedField) {
        return err(domainError.unexpected({ message: 'Field not deleted' }));
      }

      await pluginExecution.afterCommit({
        ...basePluginContext,
        table: updateResult.table,
        result: {
          deletedField,
        },
      });
      await sideEffectPluginExecution.afterCommit();

      return ok(
        DeleteFieldResult.create(updateResult.table, updateResult.events, undoCommand, redoCommand)
      );
    });
  }

  private async executeDeletionEntityCleanup(
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
