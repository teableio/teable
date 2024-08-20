import { FieldKeyType } from '@teable/core';
import type { IRecordInsertOrderRo } from '@teable/openapi';
import { OperationName, type IDeleteRecordOperation } from '../../../cache/types';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { RecordService } from '../../record/record.service';

export interface IDeleteRecordPayload {
  reqParams: { tableId: string; recordId: string };
  reqQuery: { order?: IRecordInsertOrderRo };
}

export class DeleteRecordOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService
  ) {}

  async event2Operation(payload: IDeleteRecordPayload): Promise<IDeleteRecordOperation> {
    console.log(payload);

    const { reqParams, reqQuery } = payload;
    const { tableId, recordId } = reqParams;

    const record = await this.recordService.getRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
    });

    return {
      name: OperationName.DeleteRecord,
      params: {
        tableId: reqParams.tableId,
        recordId: reqParams.recordId,
        order: reqQuery.order,
      },
      result: {
        record: record,
      },
    };
  }

  async undo(operation: IDeleteRecordOperation) {
    const { params, result } = operation;

    await this.recordOpenApiService.createRecords(params.tableId, {
      fieldKeyType: FieldKeyType.Id,
      order: params.order,
      records: [result.record],
    });
  }

  async redo(operation: IDeleteRecordOperation) {
    const { params } = operation;
    const { tableId, recordId } = params;

    await this.recordOpenApiService.deleteRecord(tableId, recordId);
  }
}
