import type { IRecord } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import { OperationName, type IDeleteRecordOperation } from '../../../cache/types';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { RecordService } from '../../record/record.service';

export interface IDeleteRecordPayload {
  reqParams: { tableId: string; recordId: string };
}

export class DeleteRecordOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService
  ) {}

  async event2Operation(payload: {
    windowId: string;
    record: IRecord;
    tableId: string;
    userId: string;
    order: Record<string, number>;
  }): Promise<IDeleteRecordOperation> {
    return {
      name: OperationName.DeleteRecord,
      params: {
        tableId: payload.tableId,
        recordId: payload.record.id,
      },
      result: {
        record: { ...payload.record, order: payload.order },
      },
    };
  }

  async undo(operation: IDeleteRecordOperation) {
    const { params, result } = operation;

    await this.recordOpenApiService.createRecords(params.tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: [result.record],
    });

    return operation;
  }

  async redo(operation: IDeleteRecordOperation) {
    const { params } = operation;
    const { tableId, recordId } = params;
    await this.recordOpenApiService.deleteRecord(tableId, recordId);

    return operation;
  }
}
