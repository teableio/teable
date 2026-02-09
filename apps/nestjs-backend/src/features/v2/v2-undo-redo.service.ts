import { Injectable, Logger } from '@nestjs/common';
import type { IRecord } from '@teable/core';
import {
  RecordUpdated,
  RecordsBatchUpdated,
  RecordsBatchCreated,
  RecordsDeleted,
  RecordReordered,
  ProjectionHandler,
  ok,
} from '@teable/v2-core';
import type { IExecutionContext, IEventHandler, DomainError, Result } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import {
  OperationName,
  type IUpdateRecordsOperation,
  type IUpdateRecordsOrderOperation,
  type ICreateRecordsOperation,
  type IDeleteRecordsOperation,
} from '../../cache/types';
import type { ICellContext } from '../calculation/utils/changes';
import { UndoRedoStackService } from '../undo-redo/stack/undo-redo-stack.service';

/**
 * V2 projection handler that pushes update operations to undo/redo stack
 * for single record updates.
 */
@ProjectionHandler(RecordUpdated)
class V2RecordUpdatedUndoRedoProjection implements IEventHandler<RecordUpdated> {
  constructor(private readonly undoRedoStackService: UndoRedoStackService) {}

  async handle(
    context: IExecutionContext,
    event: RecordUpdated
  ): Promise<Result<void, DomainError>> {
    const { windowId, actorId } = context;

    // Skip if no windowId - undo/redo requires window context
    if (!windowId) {
      return ok(undefined);
    }

    // Skip computed changes - they are derived, not user-initiated
    if (event.source === 'computed') {
      return ok(undefined);
    }

    const userId = actorId.toString();
    const tableId = event.tableId.toString();
    const recordId = event.recordId.toString();

    // Convert V2 changes to V1 cell contexts
    const cellContexts: ICellContext[] = event.changes.map((change) => ({
      recordId,
      fieldId: change.fieldId,
      oldValue: change.oldValue,
      newValue: change.newValue,
    }));

    const fieldIds = event.changes.map((c) => c.fieldId);

    const operation: IUpdateRecordsOperation = {
      name: OperationName.UpdateRecords,
      params: {
        tableId,
        recordIds: [recordId],
        fieldIds,
      },
      result: {
        cellContexts,
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
  constructor(private readonly undoRedoStackService: UndoRedoStackService) {}

  async handle(
    context: IExecutionContext,
    event: RecordsBatchUpdated
  ): Promise<Result<void, DomainError>> {
    const { windowId, actorId } = context;

    // Skip if no windowId - undo/redo requires window context
    if (!windowId) {
      return ok(undefined);
    }

    // Skip computed changes - they are derived, not user-initiated
    if (event.source === 'computed') {
      return ok(undefined);
    }

    const userId = actorId.toString();
    const tableId = event.tableId.toString();

    // Collect all record IDs, field IDs, and cell contexts
    const recordIds: string[] = [];
    const fieldIdSet = new Set<string>();
    const cellContexts: ICellContext[] = [];

    for (const update of event.updates) {
      const recordId = update.recordId;
      recordIds.push(recordId);

      for (const change of update.changes) {
        fieldIdSet.add(change.fieldId);
        cellContexts.push({
          recordId,
          fieldId: change.fieldId,
          oldValue: change.oldValue,
          newValue: change.newValue,
        });
      }
    }

    const fieldIds = Array.from(fieldIdSet);

    const operation: IUpdateRecordsOperation = {
      name: OperationName.UpdateRecords,
      params: {
        tableId,
        recordIds,
        fieldIds,
      },
      result: {
        cellContexts,
      },
    };

    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
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

    // Register projection instances directly since they depend on NestJS UndoRedoStackService
    container.registerInstance(
      V2RecordUpdatedUndoRedoProjection,
      new V2RecordUpdatedUndoRedoProjection(undoRedoStackService)
    );

    container.registerInstance(
      V2RecordsBatchUpdatedUndoRedoProjection,
      new V2RecordsBatchUpdatedUndoRedoProjection(undoRedoStackService)
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
