import { FieldKeyType } from '@teable/core';
import type { ICreateRecordsRo, IRecordsVo } from '@teable/openapi';
import { OperationName, type ICreateRecordsOperation } from '../../../cache/types';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { RecordService } from '../../record/record.service';

export interface ICreateRecordsPayload {
  reqParams: { tableId: string };
  reqBody: ICreateRecordsRo;
  resolveData: IRecordsVo;
}

export class CreateRecordsOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService
  ) {}

  async event2Operation(payload: ICreateRecordsPayload): Promise<ICreateRecordsOperation> {
    const { reqParams, resolveData } = payload;
    const { tableId } = reqParams;
    const { records } = resolveData;

    const recordIds = records.map((record) => record.id);

    const indexes = await this.recordService.getRecordIndexes(tableId, recordIds);
    return {
      name: OperationName.CreateRecords,
      params: {
        tableId: tableId,
      },
      result: {
        records: records.map((r, i) => ({ ...r, order: indexes?.[i] })),
      },
    };
  }

  async undo(operation: ICreateRecordsOperation) {
    const { params, result } = operation;

    const recordIds = result.records.map((record) => record.id);

    await this.recordOpenApiService.deleteRecords(params.tableId, recordIds);
    return operation;
  }

  async redo(operation: ICreateRecordsOperation) {
    const { params, result } = operation;

    await this.recordOpenApiService.multipleCreateRecords(params.tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: result.records,
    });
    return operation;
  }
}
