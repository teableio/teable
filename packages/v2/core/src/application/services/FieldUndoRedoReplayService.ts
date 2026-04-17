import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { CreateFieldCommand } from '../../commands/CreateFieldCommand';
import { UpdateFieldCommand, type IFieldUpdateInput } from '../../commands/UpdateFieldCommand';
import { BaseId } from '../../domain/base/BaseId';
import { domainError, isNotFoundError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { composeAndSpecsOrUndefined } from '../../domain/shared/specification/composeAndSpecs';
import type { RecordFieldChangeDTO } from '../../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchUpdated } from '../../domain/table/events/RecordsBatchUpdated';
import type { Field } from '../../domain/table/fields/Field';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldHasError } from '../../domain/table/fields/types/FieldHasError';
import { FieldNotNull } from '../../domain/table/fields/types/FieldNotNull';
import { FieldUnique } from '../../domain/table/fields/types/FieldUnique';
import type { UpdateRecordItem } from '../../domain/table/methods/records';
import { RecordId } from '../../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../../domain/table/records/RecordUpdateResult';
import { RecordByIdsSpec } from '../../domain/table/records/specs/RecordByIdsSpec';
import { TableUpdateFieldConstraintsSpec } from '../../domain/table/specs/TableUpdateFieldConstraintsSpec';
import { TableUpdateFieldHasErrorSpec } from '../../domain/table/specs/TableUpdateFieldHasErrorSpec';
import {
  TableUpdateViewColumnMetaSpec,
  type TableViewColumnMetaUpdate,
} from '../../domain/table/specs/TableUpdateViewColumnMetaSpec';
import {
  TableUpdateViewQueryDefaultsSpec,
  type TableViewQueryDefaultsUpdate,
} from '../../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableUpdateResult } from '../../domain/table/TableMutator';
import { ViewColumnMeta } from '../../domain/table/views/ViewColumnMeta';
import { ViewQueryDefaults } from '../../domain/table/views/ViewQueryDefaults';
import * as CommandBusPort from '../../ports/CommandBus';
import * as EventBusPort from '../../ports/EventBus';
import * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableRecordQueryRepositoryPort from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import * as TableRecordRepositoryPort from '../../ports/TableRecordRepository';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { TeableSpanAttributes } from '../../ports/Tracer';
import { TraceSpan } from '../../ports/TraceSpan';
import type { UndoRedoFieldSnapshot, UndoRedoFieldViewSnapshot } from '../../ports/UndoRedoStore';
import * as UnitOfWorkPort from '../../ports/UnitOfWork';
import { areRecordFieldValuesEqual } from './RecordFieldValueEquality';
import { TableUpdateFlow } from './TableUpdateFlow';

const stripUndefinedDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) {
      continue;
    }
    result[key] = stripUndefinedDeep(nested);
  }
  return result;
};

const toUpdateFieldInput = (
  field: UndoRedoFieldSnapshot['field'],
  replayOptions?: {
    currentField?: Field;
    deferConstraintEnforcement?: boolean;
  }
): IFieldUpdateInput => {
  const fieldOptions = (() => {
    if (field.type === 'lookup') {
      return {
        ...field.options,
        ...(field.innerOptions ? { innerOptions: field.innerOptions } : {}),
      };
    }

    if (field.type === 'conditionalLookup') {
      return {
        ...field.options,
        ...(field.innerOptions ? { innerOptions: field.innerOptions } : {}),
      };
    }

    return 'options' in field ? field.options : undefined;
  })();

  return stripUndefinedDeep({
    type: field.type,
    ...(field.name !== undefined ? { name: field.name } : {}),
    ...(Object.prototype.hasOwnProperty.call(field, 'description')
      ? { description: field.description ?? null }
      : {}),
    ...(field.dbFieldName ? { dbFieldName: field.dbFieldName } : {}),
    ...(!replayOptions?.deferConstraintEnforcement
      ? {
          ...(field.notNull !== undefined ? { notNull: field.notNull } : {}),
          ...(field.unique !== undefined ? { unique: field.unique } : {}),
        }
      : {
          ...(field.notNull !== undefined &&
          replayOptions.currentField?.notNull().toBoolean() &&
          field.notNull !== true
            ? { notNull: false }
            : {}),
          ...(field.unique !== undefined ? { unique: field.unique } : {}),
        }),
    ...(field.aiConfig !== undefined ? { aiConfig: field.aiConfig } : {}),
    ...(fieldOptions ? { options: fieldOptions } : {}),
    ...('config' in field && field.config ? { config: field.config } : {}),
    ...('cellValueType' in field && field.cellValueType
      ? { cellValueType: field.cellValueType }
      : {}),
    ...('isMultipleCellValue' in field && field.isMultipleCellValue !== undefined
      ? { isMultipleCellValue: field.isMultipleCellValue }
      : {}),
    replaceOptions: true,
  }) as IFieldUpdateInput;
};

const toCreateFieldInput = (
  field: UndoRedoFieldSnapshot['field'],
  options?: {
    deferConstraintEnforcement?: boolean;
  }
): UndoRedoFieldSnapshot['field'] =>
  stripUndefinedDeep({
    ...field,
    ...(options?.deferConstraintEnforcement
      ? {
          ...(field.notNull !== undefined ? { notNull: false } : {}),
        }
      : {}),
  }) as UndoRedoFieldSnapshot['field'];

type FieldReplayUpdateEvent = {
  recordId: string;
  oldVersion: number;
  newVersion: number;
  changes: ReadonlyArray<RecordFieldChangeDTO>;
};

@injectable()
export class FieldUndoRedoReplayService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.commandBus)
    private readonly commandBus: CommandBusPort.ICommandBus,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow
  ) {}

  @TraceSpan({
    component: 'service',
    attributes: (context, params: { tableId: string; snapshot: UndoRedoFieldSnapshot }) => ({
      [TeableSpanAttributes.TABLE_ID]: params.tableId,
      [TeableSpanAttributes.FIELD_ID]: params.snapshot.field.id,
      'teable.undo_redo.mode': context.undoRedo?.mode ?? 'normal',
      'teable.undo_redo.view_snapshot_count': params.snapshot.views.length,
      'teable.undo_redo.record_value_count': params.snapshot.records?.length ?? 0,
    }),
  })
  async replay(
    context: ExecutionContextPort.IExecutionContext,
    params: {
      baseId: string;
      tableId: string;
      snapshot: UndoRedoFieldSnapshot;
    }
  ): Promise<Result<Table, DomainError>> {
    const service = this;
    return safeTry<Table, DomainError>(async function* () {
      const fieldId = yield* FieldId.create(params.snapshot.field.id);
      const table = yield* await service.loadTable(context, params.baseId, params.tableId);
      const currentFieldResult = table.getField((field) => field.id().equals(fieldId));
      const currentField = currentFieldResult.isOk() ? currentFieldResult.value : undefined;
      const deferConstraintEnforcement = Boolean(params.snapshot.records?.length);

      if (currentField) {
        const updateCommand = yield* UpdateFieldCommand.create(
          {
            tableId: params.tableId,
            fieldId: fieldId.toString(),
            field: toUpdateFieldInput(params.snapshot.field, {
              currentField,
              deferConstraintEnforcement,
            }),
          },
          {
            allowNoop: true,
          }
        );
        yield* await service.executeNested(context, updateCommand);
      } else {
        const createCommand = yield* CreateFieldCommand.create({
          baseId: params.baseId,
          tableId: params.tableId,
          field: toCreateFieldInput(params.snapshot.field, {
            deferConstraintEnforcement,
          }),
        });
        yield* await service.executeNested(context, createCommand);
      }

      let latestTable = yield* await service.loadTable(context, params.baseId, params.tableId);
      latestTable = yield* await service.applyViewSnapshots(
        context,
        latestTable,
        fieldId,
        params.snapshot.views as ReadonlyArray<UndoRedoFieldViewSnapshot>
      );
      latestTable = yield* await service.applyFieldHasErrorSnapshot(
        context,
        latestTable,
        fieldId,
        params.snapshot.hasError
      );

      if (params.snapshot.records?.length) {
        yield* await service.replayFieldValues(context, {
          table: latestTable,
          fieldId,
          records: params.snapshot.records,
        });
        latestTable = yield* await service.loadTable(context, params.baseId, params.tableId);
      }

      if (deferConstraintEnforcement) {
        latestTable = yield* await service.applyDeferredConstraints(
          context,
          latestTable,
          fieldId,
          params.snapshot.field
        );
      }

      return ok(latestTable);
    });
  }

  private async executeNested<TCommand extends CommandBusPort.IPublicCommand>(
    context: ExecutionContextPort.IExecutionContext,
    nestedCommand: TCommand
  ): Promise<Result<void, DomainError>> {
    const executeResult = await this.commandBus.execute(context, nestedCommand);
    if (executeResult.isErr()) {
      return err(executeResult.error);
    }
    return ok(undefined);
  }

  private async loadTable(
    context: ExecutionContextPort.IExecutionContext,
    baseId: string,
    tableId: string
  ): Promise<Result<Table, DomainError>> {
    const baseIdResult = BaseId.create(baseId);
    if (baseIdResult.isErr()) return err(baseIdResult.error);

    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) return err(tableIdResult.error);

    const tableSpecResult = TableAggregate.specs(baseIdResult.value)
      .byId(tableIdResult.value)
      .build();
    if (tableSpecResult.isErr()) {
      return err(tableSpecResult.error);
    }

    const tableResult = await this.tableRepository.findOne(context, tableSpecResult.value);
    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        return err(domainError.notFound({ message: 'Table not found' }));
      }
      return err(tableResult.error);
    }

    return ok(tableResult.value);
  }

  private async applyViewSnapshots(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    fieldId: FieldId,
    viewSnapshots: ReadonlyArray<UndoRedoFieldViewSnapshot>
  ): Promise<Result<Table, DomainError>> {
    const service = this;
    return safeTry<Table, DomainError>(async function* () {
      const spec = yield* service.buildViewSnapshotSpec(table, fieldId, viewSnapshots);
      if (!spec) {
        return ok(table);
      }

      const updateResult = yield* await service.tableUpdateFlow.execute(
        context,
        { table },
        (candidate) =>
          spec.mutate(candidate).map((updated) => TableUpdateResult.create(updated, spec)),
        { publishEvents: true }
      );

      return ok(updateResult.table);
    });
  }

  private buildViewSnapshotSpec(
    table: Table,
    fieldId: FieldId,
    viewSnapshots: ReadonlyArray<UndoRedoFieldViewSnapshot>
  ) {
    const columnMetaUpdates: Array<TableViewColumnMetaUpdate> = [];
    const queryDefaultsUpdates: Array<TableViewQueryDefaultsUpdate> = [];
    const snapshotsByViewId = new Map<string, UndoRedoFieldViewSnapshot>(
      viewSnapshots.map((snapshot) => [snapshot.viewId, snapshot])
    );

    for (const view of table.views()) {
      const snapshot = snapshotsByViewId.get(view.id().toString());
      if (!snapshot) {
        continue;
      }

      const columnMetaResult = view.columnMeta();
      if (columnMetaResult.isErr()) {
        return err(columnMetaResult.error);
      }

      const currentMeta = columnMetaResult.value.toDto();
      const nextMetaRaw = { ...currentMeta };
      const existingFieldIds = new Set(table.getFields().map((field) => field.id().toString()));

      for (const [index, orderedFieldId] of (snapshot.orderedFieldIds ?? []).entries()) {
        if (!existingFieldIds.has(orderedFieldId)) {
          continue;
        }
        const currentOrderMeta = nextMetaRaw[orderedFieldId];
        nextMetaRaw[orderedFieldId] =
          currentOrderMeta && typeof currentOrderMeta === 'object'
            ? { ...currentOrderMeta, order: index }
            : { order: index };
      }

      const targetFieldId = fieldId.toString();
      if (snapshot.columnMeta === null) {
        const currentOrderMeta = nextMetaRaw[targetFieldId];
        if (
          currentOrderMeta &&
          typeof currentOrderMeta === 'object' &&
          'order' in currentOrderMeta &&
          typeof currentOrderMeta.order === 'number'
        ) {
          nextMetaRaw[targetFieldId] = { order: currentOrderMeta.order };
        } else {
          delete nextMetaRaw[targetFieldId];
        }
      } else if (snapshot.columnMeta !== undefined) {
        const currentMetaForTarget = nextMetaRaw[targetFieldId];
        nextMetaRaw[targetFieldId] =
          currentMetaForTarget && typeof currentMetaForTarget === 'object'
            ? { ...currentMetaForTarget, ...snapshot.columnMeta }
            : snapshot.columnMeta;
      }

      const nextMetaResult = ViewColumnMeta.create(nextMetaRaw);
      if (nextMetaResult.isErr()) {
        return err(nextMetaResult.error);
      }
      columnMetaUpdates.push({
        viewId: view.id(),
        fieldId,
        columnMeta: nextMetaResult.value,
      });

      const queryDefaultsResult = ViewQueryDefaults.create(snapshot.query ?? {});
      if (queryDefaultsResult.isErr()) {
        return err(queryDefaultsResult.error);
      }
      queryDefaultsUpdates.push({
        viewId: view.id(),
        queryDefaults: queryDefaultsResult.value,
      });
    }

    return ok(
      composeAndSpecsOrUndefined([
        ...(columnMetaUpdates.length
          ? [TableUpdateViewColumnMetaSpec.create(columnMetaUpdates)]
          : []),
        ...(queryDefaultsUpdates.length
          ? [TableUpdateViewQueryDefaultsSpec.create(queryDefaultsUpdates)]
          : []),
      ])
    );
  }

  private async loadFieldValueSnapshotsByRecordId(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    fieldId: FieldId,
    recordIds: ReadonlyArray<RecordId>
  ): Promise<Result<ReadonlyMap<string, { value: unknown; version: number }>, DomainError>> {
    const fieldIdText = fieldId.toString();
    const snapshots = new Map<string, { value: unknown; version: number }>();

    const recordsStream = this.tableRecordQueryRepository.findStream(
      context,
      table,
      RecordByIdsSpec.create(recordIds),
      {
        mode: 'stored',
        projectionFieldIds: [fieldId],
      }
    );

    for await (const recordResult of recordsStream) {
      if (recordResult.isErr()) {
        return err(recordResult.error);
      }

      const readModel: TableRecordReadModel = recordResult.value;
      snapshots.set(readModel.id, {
        value: Object.prototype.hasOwnProperty.call(readModel.fields, fieldIdText)
          ? readModel.fields[fieldIdText]
          : null,
        version: readModel.version,
      });
    }

    return ok(snapshots);
  }

  private buildRecordsBatchUpdatedEvents(
    table: Table,
    updates: ReadonlyArray<FieldReplayUpdateEvent>
  ): ReadonlyArray<IDomainEvent> {
    if (updates.length === 0) {
      return [];
    }

    const events: IDomainEvent[] = [];
    const chunkSize = 500;
    for (let offset = 0; offset < updates.length; offset += chunkSize) {
      events.push(
        RecordsBatchUpdated.create({
          tableId: table.id(),
          baseId: table.baseId(),
          updates: updates.slice(offset, offset + chunkSize),
          source: 'user',
        })
      );
    }

    return events;
  }

  private reconcilePersistedUpdateEvents(
    updates: ReadonlyArray<FieldReplayUpdateEvent>,
    updateResult: TableRecordRepositoryPort.UpdateManyStreamResult
  ): FieldReplayUpdateEvent[] {
    const updatesWithChanges = updates.filter((update) => update.changes.length > 0);
    const persistedRecords = new Map(
      updateResult.updatedRecords.map((record) => [record.recordId.toString(), record])
    );

    const reconciledUpdates: FieldReplayUpdateEvent[] = [];
    for (const update of updatesWithChanges) {
      const persistedRecord = persistedRecords.get(update.recordId);
      if (!persistedRecord) {
        continue;
      }
      const changes: RecordFieldChangeDTO[] = [];
      for (const change of update.changes) {
        const oldValue = Object.prototype.hasOwnProperty.call(
          persistedRecord.oldFieldValues,
          change.fieldId
        )
          ? persistedRecord.oldFieldValues[change.fieldId]
          : change.oldValue;
        if (areRecordFieldValuesEqual(oldValue, change.newValue)) {
          continue;
        }
        changes.push({ ...change, oldValue });
      }
      if (changes.length === 0) {
        continue;
      }
      reconciledUpdates.push({
        ...update,
        oldVersion: persistedRecord.oldVersion,
        newVersion: persistedRecord.newVersion,
        changes,
      });
    }

    return reconciledUpdates;
  }

  @TraceSpan({
    component: 'service',
    attributes: (
      context,
      params: {
        table: Table;
        fieldId: FieldId;
        records: NonNullable<UndoRedoFieldSnapshot['records']>;
      }
    ) => ({
      [TeableSpanAttributes.TABLE_ID]: params.table.id().toString(),
      [TeableSpanAttributes.FIELD_ID]: params.fieldId.toString(),
      'teable.undo_redo.mode': context.undoRedo?.mode ?? 'normal',
      'teable.undo_redo.record_value_count': params.records.length,
    }),
  })
  private async replayFieldValues(
    context: ExecutionContextPort.IExecutionContext,
    params: {
      table: Table;
      fieldId: FieldId;
      records: NonNullable<UndoRedoFieldSnapshot['records']>;
    }
  ): Promise<Result<void, DomainError>> {
    const service = this;
    return safeTry<void, DomainError>(async function* () {
      const targetRecordIds: RecordId[] = [];
      const targetRecordIdsByText = new Map<string, RecordId>();
      for (const record of params.records) {
        const recordId = yield* RecordId.create(record.recordId);
        targetRecordIds.push(recordId);
        targetRecordIdsByText.set(record.recordId, recordId);
      }

      if (targetRecordIds.length === 0) {
        return ok(undefined);
      }

      const currentSnapshots = yield* await service.loadFieldValueSnapshotsByRecordId(
        context,
        params.table,
        params.fieldId,
        targetRecordIds
      );

      const updateItems: UpdateRecordItem[] = [];
      const pendingUpdates: Array<{
        recordId: string;
        oldVersion: number;
        oldValue: unknown;
      }> = [];

      for (const record of params.records) {
        const currentSnapshot = currentSnapshots.get(record.recordId);
        if (!currentSnapshot) {
          return err(
            domainError.notFound({
              code: 'record.not_found',
              message: 'Record not found',
            })
          );
        }

        if (areRecordFieldValuesEqual(currentSnapshot.value, record.value)) {
          continue;
        }

        const recordId = targetRecordIdsByText.get(record.recordId);
        if (!recordId) {
          return err(
            domainError.notFound({
              code: 'record.not_found',
              message: 'Record not found',
            })
          );
        }

        updateItems.push({
          recordId,
          fieldValues: new Map([[params.fieldId.toString(), record.value]]),
        });
        pendingUpdates.push({
          recordId: record.recordId,
          oldVersion: currentSnapshot.version,
          oldValue: currentSnapshot.value,
        });
      }

      if (updateItems.length === 0) {
        return ok(undefined);
      }

      const updates: FieldReplayUpdateEvent[] = [];
      const batchResults: Array<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> = [];
      let resolvedUpdateIndex = 0;
      const fieldIdText = params.fieldId.toString();
      const updateBatches = params.table.updateRecordsStream(updateItems, { typecast: false });

      for (const batchResult of updateBatches) {
        if (batchResult.isErr()) {
          return err(batchResult.error);
        }

        for (const updateResult of batchResult.value) {
          const pending = pendingUpdates[resolvedUpdateIndex];
          if (!pending) {
            return err(
              domainError.unexpected({
                code: 'undo_redo.field_replay.update_event_mismatch',
                message:
                  'Failed to map field undo/redo replay updates to resolved record update results',
              })
            );
          }

          updates.push({
            recordId: pending.recordId,
            oldVersion: pending.oldVersion,
            newVersion: pending.oldVersion + 1,
            changes: [
              {
                fieldId: fieldIdText,
                oldValue: pending.oldValue,
                newValue: updateResult.record.fields().get(params.fieldId)?.toValue() ?? null,
              },
            ],
          });
          resolvedUpdateIndex += 1;
        }

        batchResults.push(batchResult);
      }

      if (resolvedUpdateIndex !== pendingUpdates.length) {
        return err(
          domainError.unexpected({
            code: 'undo_redo.field_replay.update_count_mismatch',
            message: 'Field undo/redo replay updates did not match the expected record count',
          })
        );
      }

      function* syncBatchesGenerator(): Generator<
        Result<ReadonlyArray<RecordUpdateResult>, DomainError>
      > {
        for (const batch of batchResults) {
          yield batch;
        }
      }

      const updateResult = yield* await service.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          const persistResult = await service.tableRecordRepository.updateManyStream(
            transactionContext,
            params.table,
            syncBatchesGenerator()
          );
          return persistResult;
        }
      );

      const events = service.buildRecordsBatchUpdatedEvents(
        params.table,
        service.reconcilePersistedUpdateEvents(updates, updateResult)
      );
      if (events.length > 0) {
        yield* await service.eventBus.publishMany(context, events);
      }

      return ok(undefined);
    });
  }

  private async applyFieldHasErrorSnapshot(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    fieldId: FieldId,
    hasError: boolean | undefined
  ): Promise<Result<Table, DomainError>> {
    if (hasError === undefined) {
      return ok(table);
    }

    const currentFieldResult = table.getField((field) => field.id().equals(fieldId));
    if (currentFieldResult.isErr()) {
      return err(currentFieldResult.error);
    }

    const currentField = currentFieldResult.value;
    const currentHasError = currentField.hasError();
    const nextHasError = FieldHasError.from(hasError);
    if (currentHasError.equals(nextHasError)) {
      return ok(table);
    }

    const spec = TableUpdateFieldHasErrorSpec.create(fieldId, currentHasError, nextHasError);
    const updateResult = await this.tableUpdateFlow.execute(
      context,
      { table },
      (candidate) =>
        spec.mutate(candidate).map((updated) => TableUpdateResult.create(updated, spec)),
      { publishEvents: true }
    );
    if (updateResult.isErr()) {
      return err(updateResult.error);
    }

    return ok(updateResult.value.table);
  }

  private async applyDeferredConstraints(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    fieldId: FieldId,
    snapshotField: UndoRedoFieldSnapshot['field']
  ): Promise<Result<Table, DomainError>> {
    const service = this;
    return safeTry<Table, DomainError>(async function* () {
      const currentField = yield* table.getField((field) => field.id().equals(fieldId));
      const dbFieldName = yield* currentField.dbFieldName();
      const targetNotNull =
        snapshotField.notNull === undefined
          ? currentField.notNull()
          : yield* FieldNotNull.create(snapshotField.notNull);
      const targetUnique =
        snapshotField.unique === undefined
          ? currentField.unique()
          : yield* FieldUnique.create(snapshotField.unique);

      if (
        currentField.notNull().equals(targetNotNull) &&
        currentField.unique().equals(targetUnique)
      ) {
        return ok(table);
      }

      const spec = TableUpdateFieldConstraintsSpec.create({
        fieldId,
        dbFieldName,
        previousNotNull: currentField.notNull(),
        nextNotNull: targetNotNull,
        previousUnique: currentField.unique(),
        nextUnique: targetUnique,
      });

      const updateResult = yield* await service.tableUpdateFlow.execute(
        context,
        { table },
        (candidate) =>
          spec.mutate(candidate).map((updated) => TableUpdateResult.create(updated, spec)),
        { publishEvents: true }
      );

      return ok(updateResult.table);
    });
  }
}
