import { FieldKeyType } from '@teable/core';
import type { ICreateRecordsRo, IRecordsVo } from '@teable/openapi';
import { OperationName, type ICreateRecordsOperation } from '../../../cache/types';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';

export interface ICreateRecordsPayload {
  reqParams: { tableId: string };
  reqBody: ICreateRecordsRo;
  resolveData: IRecordsVo;
}

export class CreateRecordsOperation {
  constructor(private readonly recordOpenApiService: RecordOpenApiService) {}

  async event2Operation(payload: ICreateRecordsPayload): Promise<ICreateRecordsOperation> {
    console.log(payload);
    const { reqParams, reqBody, resolveData } = payload;

    return {
      name: OperationName.CreateRecords,
      params: {
        tableId: reqParams.tableId,
        order: reqBody.order,
      },
      result: {
        records: resolveData.records,
      },
    };
  }

  async undo(operation: ICreateRecordsOperation) {
    const { params, result } = operation;

    const recordIds = result.records.map((record) => record.id);

    await this.recordOpenApiService.deleteRecords(params.tableId, recordIds);
  }

  async redo(operation: ICreateRecordsOperation) {
    const { params, result } = operation;

    console.log('redoOperation:', result);

    await this.recordOpenApiService.createRecords(params.tableId, {
      fieldKeyType: FieldKeyType.Id,
      order: params.order,
      records: result.records,
    });
  }
}
