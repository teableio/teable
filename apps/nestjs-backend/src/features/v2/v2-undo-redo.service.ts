/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import {
  CellValueType,
  FieldType,
  getDbFieldType,
  type IColumnMeta,
  type IFieldVo,
  type IOtOperation,
  type IRecord,
} from '@teable/core';
import {
  FieldCreated,
  FieldUpdated,
  ProjectionHandler,
  RecordReordered,
  RecordUpdated,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RecordsDeleted,
  TableQueryService,
  ok,
  v2CoreTokens,
  ITableMapper,
} from '@teable/v2-core';
import type { DomainError, IEventHandler, IExecutionContext, Result } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import {
  type ICreateFieldsOperation,
  OperationName,
  type IConvertFieldV2Operation,
  type ICreateRecordsOperation,
  type IDeleteRecordsOperation,
  type IUpdateRecordsOperation,
  type IUpdateRecordsOrderOperation,
} from '../../cache/types';
import type { ICellContext } from '../calculation/utils/changes';
import { UndoRedoStackService } from '../undo-redo/stack/undo-redo-stack.service';
import {
  V2_FIELD_CONVERT_UNDO_CONTEXT_KEY,
  type IV2FieldConvertUndoContext,
} from './v2-undo-redo.constants';

type IOpsMap = {
  [tableId: string]: {
    [recordId: string]: IOtOperation[];
  };
};

class V2FieldConvertUndoTracker {
  private readonly stateByKey = new Map<string, { expiresAt: number; pendingOps?: IOpsMap }>();
  private readonly ttlMs = 60 * 1000;

  private getState(key: string) {
    const now = Date.now();
    const current = this.stateByKey.get(key);
    if (current && current.expiresAt > now) {
      current.expiresAt = now + this.ttlMs;
      return current;
    }

    const next: { expiresAt: number; pendingOps?: IOpsMap } = { expiresAt: now + this.ttlMs };
    this.stateByKey.set(key, next);
    return next;
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [key, state] of this.stateByKey.entries()) {
      if (state.expiresAt <= now) {
        this.stateByKey.delete(key);
      }
    }
  }

  appendPending(keys: ReadonlyArray<string>, ops: IOpsMap) {
    this.pruneExpired();
    for (const key of new Set(keys.filter((key) => key.length > 0))) {
      const state = this.getState(key);
      state.pendingOps = mergeOpsMap(state.pendingOps, ops);
    }
  }

  consumePending(keys: ReadonlyArray<string>): IOpsMap | undefined {
    this.pruneExpired();
    let mergedOps: IOpsMap | undefined;
    for (const key of new Set(keys.filter((key) => key.length > 0))) {
      const state = this.stateByKey.get(key);
      if (!state?.pendingOps) continue;
      mergedOps = mergeOpsMap(mergedOps, state.pendingOps);
      this.stateByKey.delete(key);
    }

    return mergedOps;
  }
}

const buildFieldConvertPendingKeys = (params: {
  userId: string;
  tableId: string;
  windowId: string;
  fieldId: string;
  requestId?: string;
}) => {
  const scopeKey = `scope:${params.userId}:${params.tableId}:${params.windowId}:${params.fieldId}`;
  const requestKey = params.requestId ? `request:${params.requestId}` : undefined;
  return requestKey ? [requestKey, scopeKey] : [scopeKey];
};

const getFieldConvertUndoContext = (
  context: IExecutionContext,
  tableId: string,
  fieldId?: string
): IV2FieldConvertUndoContext | undefined => {
  const ctx = context as IExecutionContext & {
    [V2_FIELD_CONVERT_UNDO_CONTEXT_KEY]?: IV2FieldConvertUndoContext;
  };
  const convertContext = ctx[V2_FIELD_CONVERT_UNDO_CONTEXT_KEY];
  if (!convertContext) return undefined;
  if (convertContext.tableId !== tableId) return undefined;
  if (fieldId && convertContext.fieldId !== fieldId) return undefined;
  return convertContext;
};

const buildSetRecordOp = (
  fieldId: string,
  newCellValue: unknown,
  oldCellValue: unknown
): IOtOperation => {
  const next = newCellValue ?? null;
  const prev = oldCellValue ?? null;

  if (next == null || (Array.isArray(next) && next.length === 0)) {
    return {
      p: ['fields', fieldId],
      od: prev,
      oi: null,
    };
  }

  if (prev == null) {
    return {
      p: ['fields', fieldId],
      oi: next,
    };
  }

  return {
    p: ['fields', fieldId],
    od: prev,
    oi: next,
  };
};

const mergeOpsMap = (base: IOpsMap | undefined, patch: IOpsMap): IOpsMap => {
  if (!base) return patch;

  const result: IOpsMap = { ...base };
  for (const [tableId, records] of Object.entries(patch)) {
    const baseRecords = result[tableId] ?? {};
    result[tableId] = {
      ...baseRecords,
      ...records,
    };
  }

  return result;
};

const deriveCellValueType = (field: IFieldVo): CellValueType => {
  switch (field.type) {
    case FieldType.Number:
    case FieldType.Rating:
    case FieldType.AutoNumber:
      return CellValueType.Number;
    case FieldType.Checkbox:
      return CellValueType.Boolean;
    case FieldType.Date:
    case FieldType.CreatedTime:
    case FieldType.LastModifiedTime:
      return CellValueType.DateTime;
    default:
      return CellValueType.String;
  }
};

const deriveIsMultipleCellValue = (field: IFieldVo): boolean => {
  switch (field.type) {
    case FieldType.MultipleSelect:
    case FieldType.Attachment:
      return true;
    case FieldType.Link: {
      const options =
        field.options && typeof field.options === 'object' && !Array.isArray(field.options)
          ? (field.options as Record<string, unknown>)
          : undefined;
      const relationship = options?.relationship;
      return relationship === 'oneMany' || relationship === 'manyMany';
    }
    case FieldType.User: {
      const options =
        field.options && typeof field.options === 'object' && !Array.isArray(field.options)
          ? (field.options as Record<string, unknown>)
          : undefined;
      return options?.isMultiple === true;
    }
    default:
      return false;
  }
};

const normalizeUndoField = (field: IFieldVo): IFieldVo => {
  const normalized: IFieldVo = {
    ...field,
  };

  if (normalized.cellValueType == null) {
    normalized.cellValueType = deriveCellValueType(normalized);
  }

  if (normalized.isMultipleCellValue == null && deriveIsMultipleCellValue(normalized)) {
    normalized.isMultipleCellValue = true;
  }

  if (normalized.dbFieldType == null && normalized.cellValueType != null) {
    normalized.dbFieldType = getDbFieldType(
      normalized.type as FieldType,
      normalized.cellValueType,
      normalized.isMultipleCellValue
    );
  }

  return normalized;
};

const buildModifiedOps = (
  tableId: string,
  fieldId: string,
  cellContexts: ICellContext[]
): IOpsMap => {
  const mergedByRecord = new Map<string, { oldValue: unknown; newValue: unknown }>();

  for (const cell of cellContexts) {
    const current = mergedByRecord.get(cell.recordId);
    if (!current) {
      mergedByRecord.set(cell.recordId, { oldValue: cell.oldValue, newValue: cell.newValue });
      continue;
    }

    current.newValue = cell.newValue;
  }

  const recordOps = Array.from(mergedByRecord.entries()).reduce<IOpsMap[string]>(
    (acc, [recordId, value]) => {
      acc[recordId] = [buildSetRecordOp(fieldId, value.newValue, value.oldValue)];
      return acc;
    },
    {}
  );

  return {
    [tableId]: recordOps,
  };
};

const mergeConvertOperationModifiedOps = async (
  undoRedoStackService: UndoRedoStackService,
  userId: string,
  tableId: string,
  windowId: string,
  fieldId: string,
  modifiedOps: IOpsMap
) => {
  return undoRedoStackService.mergeLastOperation(userId, tableId, windowId, (operation) => {
    if (operation.name !== OperationName.ConvertFieldV2) {
      return null;
    }

    if (operation.params.tableId !== tableId) {
      return null;
    }

    const convertOperation = operation as IConvertFieldV2Operation;
    if (convertOperation.result.newField.id !== fieldId) {
      return null;
    }

    return {
      ...convertOperation,
      result: {
        ...convertOperation.result,
        modifiedOps: mergeOpsMap(
          convertOperation.result.modifiedOps as IOpsMap | undefined,
          modifiedOps
        ),
      },
    };
  });
};

/**
 * V2 projection handler that pushes update operations to undo/redo stack
 * for single record updates.
 */
@ProjectionHandler(RecordUpdated)
class V2RecordUpdatedUndoRedoProjection implements IEventHandler<RecordUpdated> {
  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly fieldConvertUndoTracker: V2FieldConvertUndoTracker
  ) {}

  async handle(
    context: IExecutionContext,
    event: RecordUpdated
  ): Promise<Result<void, DomainError>> {
    const { windowId, actorId, requestId } = context;

    // Skip if no windowId - undo/redo requires window context
    if (!windowId) {
      return ok(undefined);
    }

    const userId = actorId.toString();
    const tableId = event.tableId.toString();
    const recordId = event.recordId.toString();

    const convertContext = getFieldConvertUndoContext(context, tableId);

    const convertCellContexts: ICellContext[] = [];
    const normalCellContexts: ICellContext[] = [];

    for (const change of event.changes) {
      const cellContext: ICellContext = {
        recordId,
        fieldId: change.fieldId,
        oldValue: change.oldValue,
        newValue: change.newValue,
      };

      if (convertContext && change.fieldId === convertContext.fieldId) {
        convertCellContexts.push(cellContext);
      } else {
        normalCellContexts.push(cellContext);
      }
    }

    if (convertContext && convertCellContexts.length) {
      const modifiedOps = buildModifiedOps(tableId, convertContext.fieldId, convertCellContexts);
      const merged = await mergeConvertOperationModifiedOps(
        this.undoRedoStackService,
        userId,
        tableId,
        windowId,
        convertContext.fieldId,
        modifiedOps
      );

      if (!merged) {
        const pendingKeys = buildFieldConvertPendingKeys({
          userId,
          tableId,
          windowId,
          fieldId: convertContext.fieldId,
          requestId,
        });
        this.fieldConvertUndoTracker.appendPending(pendingKeys, modifiedOps);
      }
    }

    if (normalCellContexts.length === 0) {
      return ok(undefined);
    }

    // Skip computed changes - they are derived, not user-initiated
    if (event.source === 'computed') {
      return ok(undefined);
    }

    const fieldIds = Array.from(new Set(normalCellContexts.map((cell) => cell.fieldId)));

    const operation: IUpdateRecordsOperation = {
      name: OperationName.UpdateRecords,
      params: {
        tableId,
        recordIds: [recordId],
        fieldIds,
      },
      result: {
        cellContexts: normalCellContexts,
      },
    };

    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that pushes batch update operations to undo/redo stack.
 */
@ProjectionHandler(RecordsBatchUpdated)
class V2RecordsBatchUpdatedUndoRedoProjection implements IEventHandler<RecordsBatchUpdated> {
  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly fieldConvertUndoTracker: V2FieldConvertUndoTracker
  ) {}

  async handle(
    context: IExecutionContext,
    event: RecordsBatchUpdated
  ): Promise<Result<void, DomainError>> {
    const { windowId, actorId, requestId } = context;

    // Skip if no windowId - undo/redo requires window context
    if (!windowId) {
      return ok(undefined);
    }

    const userId = actorId.toString();
    const tableId = event.tableId.toString();
    const convertContext = getFieldConvertUndoContext(context, tableId);

    const convertCellContexts: ICellContext[] = [];
    const recordIds = new Set<string>();
    const fieldIdSet = new Set<string>();
    const cellContexts: ICellContext[] = [];

    for (const update of event.updates) {
      const recordId = update.recordId;
      for (const change of update.changes) {
        const cellContext: ICellContext = {
          recordId,
          fieldId: change.fieldId,
          oldValue: change.oldValue,
          newValue: change.newValue,
        };

        if (convertContext && change.fieldId === convertContext.fieldId) {
          convertCellContexts.push(cellContext);
          continue;
        }

        recordIds.add(recordId);
        fieldIdSet.add(change.fieldId);
        cellContexts.push(cellContext);
      }
    }

    if (convertContext && convertCellContexts.length) {
      const modifiedOps = buildModifiedOps(tableId, convertContext.fieldId, convertCellContexts);
      const merged = await mergeConvertOperationModifiedOps(
        this.undoRedoStackService,
        userId,
        tableId,
        windowId,
        convertContext.fieldId,
        modifiedOps
      );

      if (!merged) {
        const pendingKeys = buildFieldConvertPendingKeys({
          userId,
          tableId,
          windowId,
          fieldId: convertContext.fieldId,
          requestId,
        });
        this.fieldConvertUndoTracker.appendPending(pendingKeys, modifiedOps);
      }
    }

    if (!cellContexts.length) {
      return ok(undefined);
    }

    // Skip computed changes - they are derived, not user-initiated
    if (event.source === 'computed') {
      return ok(undefined);
    }

    const operation: IUpdateRecordsOperation = {
      name: OperationName.UpdateRecords,
      params: {
        tableId,
        recordIds: Array.from(recordIds),
        fieldIds: Array.from(fieldIdSet),
      },
      result: {
        cellContexts,
      },
    };

    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
    return ok(undefined);
  }
}

@ProjectionHandler(FieldCreated)
class V2FieldCreatedUndoRedoProjection implements IEventHandler<FieldCreated> {
  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly tableQueryService: TableQueryService,
    private readonly tableMapper: ITableMapper
  ) {}

  async handle(
    context: IExecutionContext,
    event: FieldCreated
  ): Promise<Result<void, DomainError>> {
    const { windowId, actorId } = context;

    if (!windowId) {
      return ok(undefined);
    }

    const tableId = event.tableId.toString();
    const userId = actorId.toString();
    const fieldId = event.fieldId.toString();

    const tableResult = await this.tableQueryService.getById(context, event.tableId);
    if (tableResult.isErr()) {
      return ok(undefined);
    }

    const tableDtoResult = this.tableMapper.toDTO(tableResult.value);
    if (tableDtoResult.isErr()) {
      return ok(undefined);
    }

    const createdField = tableDtoResult.value.fields.find((field) => field.id === fieldId);
    if (!createdField) {
      return ok(undefined);
    }

    const eventColumnMeta = Object.fromEntries(
      Object.entries(event.viewOrders ?? {}).map(([viewId, order]) => [viewId, { order }])
    ) as IColumnMeta;
    const fallbackColumnMeta = Object.fromEntries(
      tableDtoResult.value.views.flatMap((view) => {
        const column = (view.columnMeta as Record<string, unknown> | undefined)?.[fieldId];
        return column == null ? [] : [[view.id, column]];
      })
    ) as IColumnMeta;
    const normalizedColumnMeta =
      Object.keys(eventColumnMeta).length > 0 ? eventColumnMeta : fallbackColumnMeta;
    const createdFieldWithMeta: IFieldVo & { columnMeta?: IColumnMeta } = {
      ...normalizeUndoField(createdField as unknown as IFieldVo),
      ...(Object.keys(normalizedColumnMeta).length > 0 ? { columnMeta: normalizedColumnMeta } : {}),
    };

    const operation: ICreateFieldsOperation = {
      name: OperationName.CreateFields,
      params: {
        tableId,
      },
      result: {
        fields: [createdFieldWithMeta],
      },
    };

    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that captures field type-conversion events and pushes
 * convert-field operations to undo/redo stack.
 */
@ProjectionHandler(FieldUpdated)
class V2FieldUpdatedUndoRedoProjection implements IEventHandler<FieldUpdated> {
  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly fieldConvertUndoTracker: V2FieldConvertUndoTracker,
    private readonly tableQueryService: TableQueryService,
    private readonly tableMapper: ITableMapper
  ) {}

  async handle(
    context: IExecutionContext,
    event: FieldUpdated
  ): Promise<Result<void, DomainError>> {
    const { windowId, actorId, requestId } = context;

    if (!windowId) {
      return ok(undefined);
    }

    const tableId = event.tableId.toString();
    const fieldId = event.fieldId.toString();
    const convertContext = getFieldConvertUndoContext(context, tableId, fieldId);

    if (!convertContext) {
      return ok(undefined);
    }

    const tableResult = await this.tableQueryService.getById(context, event.tableId);
    if (tableResult.isErr()) {
      return ok(undefined);
    }

    const tableDtoResult = this.tableMapper.toDTO(tableResult.value);
    if (tableDtoResult.isErr()) {
      return ok(undefined);
    }

    const newField = tableDtoResult.value.fields.find((item) => item.id === fieldId);
    if (!newField) {
      return ok(undefined);
    }

    const pendingKeys = buildFieldConvertPendingKeys({
      userId: actorId.toString(),
      tableId,
      windowId,
      fieldId,
      requestId,
    });
    let modifiedOps = this.fieldConvertUndoTracker.consumePending(pendingKeys);

    const merged = await this.undoRedoStackService.mergeLastOperation(
      actorId.toString(),
      tableId,
      windowId,
      (operation) => {
        if (operation.name !== OperationName.ConvertFieldV2) {
          return null;
        }

        const convertOperation = operation as IConvertFieldV2Operation;
        if (convertOperation.params.tableId !== tableId) {
          return null;
        }
        if (convertOperation.result.newField.id !== fieldId) {
          return null;
        }
        return {
          ...convertOperation,
          result: {
            ...convertOperation.result,
            oldField: convertContext.oldField,
            newField: newField as unknown as IFieldVo,
            ...(modifiedOps
              ? {
                  modifiedOps: mergeOpsMap(
                    convertOperation.result.modifiedOps as IOpsMap | undefined,
                    modifiedOps
                  ),
                }
              : {}),
          },
        };
      }
    );
    if (merged) {
      return ok(undefined);
    }

    const operation: IConvertFieldV2Operation = {
      name: OperationName.ConvertFieldV2,
      params: {
        tableId,
      },
      result: {
        oldField: convertContext.oldField,
        newField: newField as unknown as IFieldVo,
        ...(modifiedOps ? { modifiedOps } : {}),
      },
    };

    await this.undoRedoStackService.push(actorId.toString(), tableId, windowId, operation);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that pushes record reorder operations to undo/redo stack.
 */
@ProjectionHandler(RecordReordered)
class V2RecordReorderedUndoRedoProjection implements IEventHandler<RecordReordered> {
  constructor(private readonly undoRedoStackService: UndoRedoStackService) {}

  async handle(
    context: IExecutionContext,
    event: RecordReordered
  ): Promise<Result<void, DomainError>> {
    const { windowId, actorId } = context;

    // Skip if no windowId - undo/redo requires window context
    if (!windowId) {
      return ok(undefined);
    }

    const userId = actorId.toString();
    const tableId = event.tableId.toString();
    const viewId = event.viewId.toString();
    const recordIds = event.recordIds.map((recordId) => recordId.toString());

    const ordersMap = recordIds.reduce<
      NonNullable<IUpdateRecordsOrderOperation['result']['ordersMap']>
    >((acc, recordId) => {
      const oldOrder = event.previousOrdersByRecordId[recordId];
      const newOrder = event.ordersByRecordId[recordId];
      if (oldOrder === undefined && newOrder === undefined) {
        return acc;
      }

      if (oldOrder === newOrder) {
        return acc;
      }

      acc[recordId] = {
        oldOrder: oldOrder !== undefined ? { [viewId]: oldOrder } : undefined,
        newOrder: newOrder !== undefined ? { [viewId]: newOrder } : undefined,
      };
      return acc;
    }, {});

    const merged = await this.undoRedoStackService.mergeLastOperation(
      userId,
      tableId,
      windowId,
      (operation) => {
        if (operation.name !== OperationName.UpdateRecords) {
          return null;
        }
        if (operation.params.tableId !== tableId) {
          return null;
        }

        const sameRecordIds =
          operation.params.recordIds.length === recordIds.length &&
          operation.params.recordIds.every((id) => recordIds.includes(id));
        if (!sameRecordIds) {
          return null;
        }

        return {
          ...operation,
          result: {
            ...operation.result,
            ordersMap: {
              ...(operation.result.ordersMap ?? {}),
              ...ordersMap,
            },
          },
        };
      }
    );
    if (merged) {
      return ok(undefined);
    }

    const operation: IUpdateRecordsOrderOperation = {
      name: OperationName.UpdateRecordsOrder,
      params: {
        tableId,
        viewId,
        recordIds,
      },
      result: {
        ordersMap,
      },
    };

    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
    return ok(undefined);
  }
}

/**
 * V2 projection handler for delete operations.
 * Pushes delete operations to undo/redo stack for record restoration.
 */
@ProjectionHandler(RecordsDeleted)
class V2RecordsDeletedUndoRedoProjection implements IEventHandler<RecordsDeleted> {
  constructor(private readonly undoRedoStackService: UndoRedoStackService) {}

  async handle(
    context: IExecutionContext,
    event: RecordsDeleted
  ): Promise<Result<void, DomainError>> {
    const { windowId, actorId } = context;

    // Skip if no windowId - undo/redo requires window context
    if (!windowId) {
      return ok(undefined);
    }

    // Skip if no snapshots - nothing to undo
    if (event.recordSnapshots.length === 0) {
      return ok(undefined);
    }

    const userId = actorId.toString();
    const tableId = event.tableId.toString();

    // Convert V2 record snapshots to V1 IRecord format with orders
    const records: (IRecord & { order?: Record<string, number> })[] = event.recordSnapshots.map(
      (snapshot) => ({
        id: snapshot.id,
        fields: snapshot.fields,
        autoNumber: snapshot.autoNumber,
        createdTime: snapshot.createdTime,
        createdBy: snapshot.createdBy,
        lastModifiedTime: snapshot.lastModifiedTime,
        lastModifiedBy: snapshot.lastModifiedBy,
        order: snapshot.orders,
      })
    );

    const operation: IDeleteRecordsOperation = {
      name: OperationName.DeleteRecords,
      params: {
        tableId,
      },
      result: {
        records,
      },
    };

    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
    return ok(undefined);
  }
}

// Note: Create operations are not yet implemented because:
// - RecordCreated/RecordsBatchCreated events don't include the full record data with order
// These would require fetching additional data from the database, which adds complexity.
// For now, V2 create operations won't support undo/redo until we enhance the events
// or add data fetching in the projection handlers.

/**
 * V2 projection handler that pushes batch create operations to undo/redo stack.
 * Enables undo (delete created records) and redo (recreate records) for batch creates.
 */
@ProjectionHandler(RecordsBatchCreated)
class V2RecordsBatchCreatedUndoRedoProjection implements IEventHandler<RecordsBatchCreated> {
  constructor(private readonly undoRedoStackService: UndoRedoStackService) {}

  async handle(
    context: IExecutionContext,
    event: RecordsBatchCreated
  ): Promise<Result<void, DomainError>> {
    const { windowId, actorId } = context;

    // Skip if no windowId - undo/redo requires window context
    if (!windowId) {
      return ok(undefined);
    }

    const userId = actorId.toString();
    const tableId = event.tableId.toString();

    // Convert V2 event records to V1 IRecord format with orders
    const records: (IRecord & { order?: Record<string, number> })[] = event.records.map(
      (record) => ({
        id: record.recordId,
        fields: Object.fromEntries(record.fields.map((f) => [f.fieldId, f.value])),
        order: record.orders,
      })
    );

    const operation: ICreateRecordsOperation = {
      name: OperationName.CreateRecords,
      params: {
        tableId,
      },
      result: {
        records,
      },
    };

    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
    return ok(undefined);
  }
}

/**
 * Service that registers V2 undo/redo projections with the V2 container.
 * These projections push operations to the V1 undo/redo stack for V2 record updates.
 */
@Injectable()
export class V2UndoRedoService {
  private readonly logger = new Logger(V2UndoRedoService.name);

  constructor(private readonly undoRedoStackService: UndoRedoStackService) {}

  /**
   * Register undo/redo projections with the V2 container.
   * Call this after the V2 container is created.
   */
  registerProjections(container: DependencyContainer): void {
    this.logger.log('Registering V2 undo/redo projections');

    const undoRedoStackService = this.undoRedoStackService;
    const fieldConvertUndoTracker = new V2FieldConvertUndoTracker();
    const tableQueryService = container.resolve<TableQueryService>(v2CoreTokens.tableQueryService);
    const tableMapper = container.resolve<ITableMapper>(v2CoreTokens.tableMapper);

    // Register projection instances directly since they depend on NestJS UndoRedoStackService
    container.registerInstance(
      V2RecordUpdatedUndoRedoProjection,
      new V2RecordUpdatedUndoRedoProjection(undoRedoStackService, fieldConvertUndoTracker)
    );

    container.registerInstance(
      V2RecordsBatchUpdatedUndoRedoProjection,
      new V2RecordsBatchUpdatedUndoRedoProjection(undoRedoStackService, fieldConvertUndoTracker)
    );

    container.registerInstance(
      V2FieldUpdatedUndoRedoProjection,
      new V2FieldUpdatedUndoRedoProjection(
        undoRedoStackService,
        fieldConvertUndoTracker,
        tableQueryService,
        tableMapper
      )
    );

    container.registerInstance(
      V2FieldCreatedUndoRedoProjection,
      new V2FieldCreatedUndoRedoProjection(undoRedoStackService, tableQueryService, tableMapper)
    );

    container.registerInstance(
      V2RecordReorderedUndoRedoProjection,
      new V2RecordReorderedUndoRedoProjection(undoRedoStackService)
    );

    container.registerInstance(
      V2RecordsBatchCreatedUndoRedoProjection,
      new V2RecordsBatchCreatedUndoRedoProjection(undoRedoStackService)
    );

    container.registerInstance(
      V2RecordsDeletedUndoRedoProjection,
      new V2RecordsDeletedUndoRedoProjection(undoRedoStackService)
    );
  }
}
