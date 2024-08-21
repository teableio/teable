import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events, IEventRawContext } from '../../../event-emitter/events';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { RecordService } from '../../record/record.service';
import type { ICreateRecordsPayload } from '../operations/create-records.operation';
import { CreateRecordsOperation } from '../operations/create-records.operation';
import { DeleteRecordOperation, IDeleteRecordPayload } from '../operations/delete-record.operation';
import { IUpdateRecordPayload, UpdateRecordOperation } from '../operations/update-record.operation';
import { UndoRedoStackService } from './undo-redo-stack.service';

@Injectable()
export class UndoRedoOperationService {
  createRecords: CreateRecordsOperation;
  deleteRecord: DeleteRecordOperation;
  updateRecord: UpdateRecordOperation;

  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService
  ) {
    this.createRecords = new CreateRecordsOperation(this.recordOpenApiService, this.recordService);
    this.deleteRecord = new DeleteRecordOperation(this.recordOpenApiService, this.recordService);
    this.updateRecord = new UpdateRecordOperation(this.recordOpenApiService, this.recordService);
  }

  @OnEvent(Events.CONTROLLER_RECORDS_CREATE)
  private async onCreateRecords(payload: IEventRawContext) {
    const windowId = payload.reqHeaders['x-window-id'] as string;
    const userId = payload.reqUser?.id;
    if (!windowId || !userId) {
      return;
    }
    const operation = await this.createRecords.event2Operation(payload as ICreateRecordsPayload);
    await this.undoRedoStackService.push(userId, operation.params.tableId, windowId, operation);
  }

  @OnEvent(Events.CONTROLLER_RECORD_DELETE)
  private async onDeleteRecord(payload: IDeleteRecordPayload) {
    const { windowId, userId, tableId } = payload;

    const operation = await this.deleteRecord.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }

  @OnEvent(Events.CONTROLLER_RECORD_UPDATE)
  private async onUpdateRecord(payload: IUpdateRecordPayload) {
    const { windowId, userId, tableId } = payload;

    const operation = await this.updateRecord.event2Operation(payload);
    await this.undoRedoStackService.push(userId, tableId, windowId, operation);
  }
}
