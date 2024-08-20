import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events, IEventRawContext } from '../../../event-emitter/events';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { RecordService } from '../../record/record.service';
import type { ICreateRecordsPayload } from '../operations/create-records.operation';
import { CreateRecordsOperation } from '../operations/create-records.operation';
import type { IDeleteRecordPayload } from '../operations/delete-record.operation';
import { DeleteRecordOperation } from '../operations/delete-record.operation';
import { UndoRedoStackService } from './undo-redo-stack.service';

@Injectable()
export class UndoRedoOperationService {
  createRecords: CreateRecordsOperation;
  deleteRecord: DeleteRecordOperation;

  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService
  ) {
    this.createRecords = new CreateRecordsOperation(this.recordOpenApiService);
    this.deleteRecord = new DeleteRecordOperation(this.recordOpenApiService, this.recordService);
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
  private async onDeleteRecord(payload: IEventRawContext) {
    const windowId = payload.reqHeaders['x-window-id'] as string;
    const userId = payload.reqUser?.id;
    if (!windowId || !userId) {
      return;
    }
    const operation = await this.deleteRecord.event2Operation(payload as IDeleteRecordPayload);
    await this.undoRedoStackService.push(userId, operation.params.tableId, windowId, operation);
  }
}
