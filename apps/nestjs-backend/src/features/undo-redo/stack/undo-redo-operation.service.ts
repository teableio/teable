import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { assertNever } from '@teable/core';
import type { IUndoRedoOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import { Events, IEventRawContext } from '../../../event-emitter/events';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { RecordService } from '../../record/record.service';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import type { ICreateRecordsPayload } from '../operations/create-records.operation';
import { CreateRecordsOperation } from '../operations/create-records.operation';
import {
  DeleteRecordsOperation,
  IDeleteRecordsPayload,
} from '../operations/delete-records.operation';
import {
  IUpdateRecordsOrderPayload,
  UpdateRecordsOrderOperation,
} from '../operations/update-records-order.operation';
import {
  UpdateRecordsOperation,
  IUpdateRecordsPayload,
} from '../operations/update-records.operation';
import { UndoRedoStackService } from './undo-redo-stack.service';

@Injectable()
export class UndoRedoOperationService {
  createRecords: CreateRecordsOperation;
  deleteRecords: DeleteRecordsOperation;
  updateRecords: UpdateRecordsOperation;
  updateRecordsOrder: UpdateRecordsOrderOperation;

  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly recordService: RecordService
  ) {
    this.createRecords = new CreateRecordsOperation(this.recordOpenApiService, this.recordService);
    this.deleteRecords = new DeleteRecordsOperation(this.recordOpenApiService, this.recordService);
    this.updateRecords = new UpdateRecordsOperation(this.recordOpenApiService, this.recordService);
    this.updateRecordsOrder = new UpdateRecordsOrderOperation(this.viewOpenApiService);
  }

  async undo(operation: IUndoRedoOperation): Promise<IUndoRedoOperation> {
    switch (operation.name) {
      case OperationName.CreateRecords:
        return this.createRecords.undo(operation);
      case OperationName.DeleteRecords:
        return this.deleteRecords.undo(operation);
      case OperationName.UpdateRecords:
        return this.updateRecords.undo(operation);
      case OperationName.UpdateRecordsOrder:
        return this.updateRecordsOrder.undo(operation);
      default:
        assertNever(operation);
    }
  }

  async redo(operation: IUndoRedoOperation): Promise<IUndoRedoOperation> {
    switch (operation.name) {
      case OperationName.CreateRecords:
        return this.createRecords.redo(operation);
      case OperationName.DeleteRecords:
        return this.deleteRecords.redo(operation);
      case OperationName.UpdateRecords:
        return this.updateRecords.redo(operation);
      case OperationName.UpdateRecordsOrder:
        return this.updateRecordsOrder.redo(operation);
      default:
        assertNever(operation);
    }
  }

  @OnEvent(Events.OPERATION_RECORDS_CREATE)
  private async onCreateRecords(payload: IEventRawContext) {
    const windowId = payload.reqHeaders['x-window-id'] as string;
    const userId = payload.reqUser?.id;
    if (!windowId || !userId) {
      return;
    }
    const operation = await this.createRecords.event2Operation(payload as ICreateRecordsPayload);
    await this.undoRedoStackService.push(userId, operation.params.tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_RECORDS_DELETE)
  private async onDeleteRecords(payload: IDeleteRecordsPayload) {
    const { windowId, userId, tableId } = payload;

    const operation = await this.deleteRecords.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_RECORDS_UPDATE)
  private async onUpdateRecords(payload: IUpdateRecordsPayload) {
    const { windowId, userId, tableId } = payload;

    const operation = await this.updateRecords.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_RECORDS_ORDER_UPDATE)
  private async onUpdateRecordsOrder(payload: IUpdateRecordsOrderPayload) {
    const { windowId, userId, tableId } = payload;

    const operation = await this.updateRecordsOrder.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }
}
