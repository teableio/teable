import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import {
  FieldOperationPluginRunner,
  type FieldOperationPluginExecution,
} from '../application/services/FieldOperationPluginRunner';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { composeAndSpecsOrUndefined } from '../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { Field } from '../domain/table/fields/Field';
import type { FieldId } from '../domain/table/fields/FieldId';
import { LinkForeignTableReferenceVisitor } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import {
  implementsOnTeableFieldDeleted,
  type FieldDeletionContext,
  type FieldDeletionReaction,
} from '../domain/table/OnTeableFieldDeleted';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { TableUpdateViewColumnMetaSpec } from '../domain/table/specs/TableUpdateViewColumnMetaSpec';
import { TableUpdateViewQueryDefaultsSpec } from '../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import { TableUpdateResult } from '../domain/table/TableMutator';
import { implementsOnTeableViewFieldDeleted } from '../domain/table/views/OnTeableViewFieldDeleted';
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
import { ITableRepository } from '../ports/TableRepository';
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

type FieldDeletionCleanup = {
  readonly spec?: ISpecification<Table, ITableSpecVisitor>;
  readonly relatedFieldIds: ReadonlyArray<FieldId>;
};

type DeletionCleanupTableState = {
  readonly orderedTableIds: ReadonlyArray<string>;
  readonly tablesById: Map<string, Table>;
};

@CommandHandler(DeleteFieldsCommand)
@injectable()
export class DeleteFieldsHandler
  implements ICommandHandler<DeleteFieldsCommand, DeleteFieldsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldDeletionSideEffectService)
    private readonly fieldDeletionSideEffectService: FieldDeletionSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.fieldOperationPluginRunner)
    private readonly fieldOperationPluginRunner: FieldOperationPluginRunner,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.fieldDeleteSnapshotSink)
    private readonly fieldDeleteSnapshotSink: IFieldDeleteSnapshotSink
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteFieldsCommand
  ): Promise<Result<DeleteFieldsResult, DomainError>> {
    const handler = this;
    return safeTry<DeleteFieldsResult, DomainError>(async function* () {
      const events: IDomainEvent[] = [];
      const targetFieldIds = new Set(command.fieldIds.map((fieldId) => fieldId.toString()));
      const relatedUndoSnapshotKeys = new Set<string>();
      const targetUndoLeaves: UndoRedoCommandLeafData[] = [];
      const relatedUndoLeaves: UndoRedoCommandLeafData[] = [];

      const tableSpec = yield* TableAggregate.specs(command.baseId).byId(command.tableId).build();
      const initialTable = yield* await handler.tableRepository.findOne(context, tableSpec);
      const targetFields = yield* handler.resolveTargetFields(initialTable, command.fieldIds);

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
        initialTable,
        targetFields
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

      const referenceVisitor = new LinkForeignTableReferenceVisitor();
      const foreignRefs = yield* referenceVisitor.collect(targetFields);
      // Allow missing foreign tables so orphan link fields remain deletable after
      // the foreign table is soft-deleted (trash) or permanently removed (T4927).
      const foreignTables = yield* await handler.foreignTableLoaderService.load(context, {
        references: foreignRefs,
        allowMissing: true,
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
                      }
                    );

                  const cleanupResult = yield* await handler.executeDeletionEntityCleanups(
                    transactionContext,
                    updatedTable,
                    initialTable,
                    targetFields
                  );
                  const cleanupEvents: IDomainEvent[] = [...cleanupResult.events];

                  for (const appliedDeletion of sideEffectResult.appliedDeletions) {
                    const appliedCleanupResult = yield* await handler.executeDeletionEntityCleanups(
                      transactionContext,
                      appliedDeletion.table,
                      appliedDeletion.previousTable,
                      [appliedDeletion.deletedField]
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
    previousSourceTable: Table,
    deletedFields: ReadonlyArray<Field>
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
      let latestSourceTable = sourceTable;
      const events: IDomainEvent[] = [];
      const allTablesSpec = yield* TableAggregate.specs(sourceTable.baseId()).build();
      const allTables = yield* await handler.tableRepository.find(context, allTablesSpec);
      const sourceTableId = sourceTable.id().toString();
      const tableState: DeletionCleanupTableState = {
        orderedTableIds: [
          sourceTableId,
          ...allTables
            .filter((table) => !table.id().equals(sourceTable.id()))
            .map((table) => table.id().toString()),
        ],
        tablesById: new Map([
          ...allTables.map((table) => [table.id().toString(), table] as const),
          [sourceTableId, sourceTable] as const,
        ]),
      };

      for (const deletedField of deletedFields) {
        const cleanupResult = yield* await handler.executeDeletionEntityCleanup(
          context,
          latestSourceTable,
          previousSourceTable,
          deletedField,
          tableState
        );
        latestSourceTable = cleanupResult.sourceTable;
        events.push(...cleanupResult.events);
      }

      return ok({
        sourceTable: latestSourceTable,
        events,
      });
    });
  }

  private async executeDeletionEntityCleanup(
    context: ExecutionContextPort.IExecutionContext,
    sourceTable: Table,
    previousSourceTable: Table,
    deletedField: Field,
    tableState: DeletionCleanupTableState
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
      let latestSourceTable = sourceTable;
      const events: IDomainEvent[] = [];
      tableState.tablesById.set(sourceTable.id().toString(), sourceTable);

      for (const tableId of tableState.orderedTableIds) {
        const table = tableState.tablesById.get(tableId);
        if (!table) {
          continue;
        }
        const candidateTable = table.id().equals(latestSourceTable.id())
          ? latestSourceTable
          : table;

        const cleanupResult = handler.buildDeletionCleanup(candidateTable, deletedField, {
          table: candidateTable,
          sourceTable: latestSourceTable,
          previousSourceTable,
        });
        if (cleanupResult.isErr()) return err(cleanupResult.error);
        const cleanupSpec = cleanupResult.value.spec;
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
        tableState.tablesById.set(updateResult.table.id().toString(), updateResult.table);
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
    deletedFields: ReadonlyArray<Field>
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

      for (const deletedField of deletedFields) {
        for (const candidateTable of orderedTables) {
          const cleanupResult = handler.buildDeletionCleanup(candidateTable, deletedField, {
            table: candidateTable,
            sourceTable,
            previousSourceTable: sourceTable,
          });
          if (cleanupResult.isErr()) {
            return err(cleanupResult.error);
          }

          for (const relatedFieldId of cleanupResult.value.relatedFieldIds) {
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
      }

      return ok(relatedSnapshots);
    });
  }

  private buildDeletionCleanup(
    candidateTable: Table,
    deletedField: Field,
    context: FieldDeletionContext
  ): Result<FieldDeletionCleanup, DomainError> {
    const specs: Array<ISpecification<Table, ITableSpecVisitor>> = [];
    const relatedFieldIds = new Map<string, FieldId>();

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
        specs.push(result.value.spec);
        this.collectRelatedFieldIds(relatedFieldIds, result.value);
      }
    }

    return ok({
      spec: composeAndSpecsOrUndefined(specs),
      relatedFieldIds: [...relatedFieldIds.values()],
    });
  }

  private collectRelatedFieldIds(
    accumulator: Map<string, FieldId>,
    reaction: FieldDeletionReaction
  ): void {
    for (const fieldId of reaction.relatedFieldIds) {
      accumulator.set(fieldId.toString(), fieldId);
    }
  }
}
