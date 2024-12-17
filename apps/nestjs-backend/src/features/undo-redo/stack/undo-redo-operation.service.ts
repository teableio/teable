/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { assertNever } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IUndoRedoOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { Events, IEventRawContext } from '../../../event-emitter/events';
import { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { RecordService } from '../../record/record.service';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import { ViewService } from '../../view/view.service';
import { ConvertFieldOperation, IConvertFieldPayload } from '../operations/convert-field.operation';
import { CreateFieldsOperation, ICreateFieldsPayload } from '../operations/create-fields.operation';
import type { ICreateRecordsPayload } from '../operations/create-records.operation';
import { CreateRecordsOperation } from '../operations/create-records.operation';
import type { ICreateViewPayload } from '../operations/create-view.operation';
import { CreateViewOperation } from '../operations/create-view.operation';
import { DeleteFieldsOperation, IDeleteFieldsPayload } from '../operations/delete-fields.operation';
import {
  DeleteRecordsOperation,
  IDeleteRecordsPayload,
} from '../operations/delete-records.operation';
import { IDeleteViewPayload, DeleteViewOperation } from '../operations/delete-view.operation';
import {
  IPasteSelectionPayload,
  PasteSelectionOperation,
} from '../operations/paste-selection.operation';
import {
  IUpdateRecordsOrderPayload,
  UpdateRecordsOrderOperation,
} from '../operations/update-records-order.operation';
import {
  UpdateRecordsOperation,
  IUpdateRecordsPayload,
} from '../operations/update-records.operation';
import { IUpdateViewPayload, UpdateViewOperation } from '../operations/update-view.operation';
import { UndoRedoStackService } from './undo-redo-stack.service';

@Injectable()
export class UndoRedoOperationService {
  createRecords: CreateRecordsOperation;
  deleteRecords: DeleteRecordsOperation;
  updateRecords: UpdateRecordsOperation;
  updateRecordsOrder: UpdateRecordsOrderOperation;
  createFields: CreateFieldsOperation;
  deleteFields: DeleteFieldsOperation;
  convertField: ConvertFieldOperation;
  pasteSelection: PasteSelectionOperation;
  deleteView: DeleteViewOperation;
  createView: CreateViewOperation;
  updateView: UpdateViewOperation;

  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly recordService: RecordService,
    private readonly viewService: ViewService,
    private readonly prismaService: PrismaService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {
    this.createRecords = new CreateRecordsOperation(this.recordOpenApiService, this.recordService);
    this.deleteRecords = new DeleteRecordsOperation(
      this.recordOpenApiService,
      this.prismaService,
      this.thresholdConfig
    );
    this.updateRecords = new UpdateRecordsOperation(this.recordOpenApiService, this.recordService);
    this.updateRecordsOrder = new UpdateRecordsOrderOperation(this.viewOpenApiService);
    this.createFields = new CreateFieldsOperation(
      this.fieldOpenApiService,
      this.recordOpenApiService
    );
    this.deleteFields = new DeleteFieldsOperation(
      this.fieldOpenApiService,
      this.recordOpenApiService,
      this.prismaService
    );
    this.convertField = new ConvertFieldOperation(this.fieldOpenApiService);
    this.pasteSelection = new PasteSelectionOperation(
      this.recordOpenApiService,
      this.fieldOpenApiService
    );
    this.deleteView = new DeleteViewOperation(
      this.viewOpenApiService,
      this.viewService,
      this.prismaService
    );
    this.createView = new CreateViewOperation(this.viewOpenApiService, this.viewService);
    this.updateView = new UpdateViewOperation(this.viewOpenApiService);
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
      case OperationName.CreateFields:
        return this.createFields.undo(operation);
      case OperationName.DeleteFields:
        return this.deleteFields.undo(operation);
      case OperationName.PasteSelection:
        return this.pasteSelection.undo(operation);
      case OperationName.ConvertField:
        return this.convertField.undo(operation);
      case OperationName.DeleteView:
        return this.deleteView.undo(operation);
      case OperationName.CreateView:
        return this.createView.undo(operation);
      case OperationName.UpdateView:
        return this.updateView.undo(operation);
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
      case OperationName.CreateFields:
        return this.createFields.redo(operation);
      case OperationName.DeleteFields:
        return this.deleteFields.redo(operation);
      case OperationName.PasteSelection:
        return this.pasteSelection.redo(operation);
      case OperationName.ConvertField:
        return this.convertField.redo(operation);
      case OperationName.DeleteView:
        return this.deleteView.redo(operation);
      case OperationName.CreateView:
        return this.createView.redo(operation);
      case OperationName.UpdateView:
        return this.updateView.redo(operation);
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
    if (!windowId || !userId) {
      return;
    }

    const operation = await this.deleteRecords.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_RECORDS_UPDATE)
  private async onUpdateRecords(payload: IUpdateRecordsPayload) {
    const { windowId, userId, tableId } = payload;
    if (!windowId || !userId) {
      return;
    }

    const operation = await this.updateRecords.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_RECORDS_ORDER_UPDATE)
  private async onUpdateRecordsOrder(payload: IUpdateRecordsOrderPayload) {
    const { windowId, userId, tableId } = payload;
    if (!windowId || !userId) {
      return;
    }

    const operation = await this.updateRecordsOrder.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_FIELDS_CREATE)
  private async onCreateFields(payload: ICreateFieldsPayload) {
    const { windowId, userId, tableId } = payload;
    if (!windowId || !userId) {
      return;
    }

    const operation = await this.createFields.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_FIELDS_DELETE)
  private async onDeleteFields(payload: IDeleteFieldsPayload) {
    const { windowId, userId, tableId } = payload;
    if (!windowId || !userId) {
      return;
    }

    const operation = await this.deleteFields.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_PASTE_SELECTION)
  private async onPasteSelection(payload: IPasteSelectionPayload) {
    const { windowId, userId, tableId } = payload;
    if (!windowId || !userId) {
      return;
    }

    const operation = await this.pasteSelection.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_FIELD_CONVERT)
  private async onConvertField(payload: IConvertFieldPayload) {
    const { windowId, userId, tableId } = payload;
    if (!windowId || !userId) {
      return;
    }

    const operation = await this.convertField.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_VIEW_DELETE)
  private async onDeleteView(payload: IDeleteViewPayload) {
    const { windowId, userId } = payload;
    if (!windowId || !userId) {
      return;
    }
    const operation = await this.deleteView.event2Operation(payload as IDeleteViewPayload);
    await this.undoRedoStackService.push(userId, operation.params.tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_VIEW_CREATE)
  private async onCreateView(payload: IEventRawContext) {
    const windowId = payload.reqHeaders['x-window-id'] as string;
    const userId = payload.reqUser?.id;
    if (!windowId || !userId) {
      return;
    }
    const operation = await this.createView.event2Operation(payload as ICreateViewPayload);
    await this.undoRedoStackService.push(userId, operation.params.tableId, windowId, operation);
  }

  @OnEvent(Events.OPERATION_VIEW_UPDATE)
  private async onUpdateView(payload: IUpdateViewPayload) {
    const { windowId, userId, tableId } = payload;
    if (!windowId || !userId) {
      return;
    }
    const operation = await this.updateView.event2Operation(payload as IUpdateViewPayload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }
}
