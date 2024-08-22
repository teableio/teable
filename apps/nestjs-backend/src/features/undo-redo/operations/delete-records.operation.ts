import type { IRecord } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import type { IDeleteRecordsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { RecordService } from '../../record/record.service';

export interface IDeleteRecordsPayload {
  windowId: string;
  tableId: string;
  userId: string;
  records: (IRecord & { order: Record<string, number> })[];
}

export class DeleteRecordsOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService
  ) {}

  async event2Operation(payload: IDeleteRecordsPayload): Promise<IDeleteRecordsOperation> {
    return {
      name: OperationName.DeleteRecords,
      params: {
        tableId: payload.tableId,
      },
      result: {
        records: payload.records,
      },
    };
  }

  async undo(operation: IDeleteRecordsOperation) {
    const { params, result } = operation;

    await this.recordOpenApiService.multipleCreateRecords(params.tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: result.records,
    });

    return operation;
  }

  async redo(operation: IDeleteRecordsOperation) {
    const { params, result } = operation;
    const { tableId } = params;

    await this.recordOpenApiService.deleteRecords(
      tableId,
      result.records.map((record) => record.id)
    );

    return operation;
  }
}
