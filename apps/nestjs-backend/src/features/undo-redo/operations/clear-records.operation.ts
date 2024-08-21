import { FieldKeyType } from '@teable/core';
import type { IRecord } from '@teable/openapi';
import type { IClearRecordsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { RecordService } from '../../record/record.service';

export interface IClearRecordsPayload {
  windowId: string;
  tableId: string;
  userId: string;
  records: IRecord[];
}

export class ClearRecordsOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService
  ) {}

  async event2Operation(payload: IClearRecordsPayload): Promise<IClearRecordsOperation> {
    const { tableId, records } = payload;
    return {
      name: OperationName.ClearRecords,
      params: {
        tableId,
      },
      result: {
        records,
      },
    };
  }

  // TODO: filter out fields that are not in the record, filter out computed fields
  async undo(operation: IClearRecordsOperation) {
    const { params, result } = operation;

    await this.recordOpenApiService.updateRecords(params.tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: result.records,
    });

    return operation;
  }

  async redo(operation: IClearRecordsOperation) {
    const { params, result } = operation;

    await this.recordOpenApiService.updateRecords(params.tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: result.records.map((record) => {
        const { id, fields } = record;
        return {
          id,
          fields: Object.keys(fields).reduce<Record<string, unknown>>((acc, fieldId) => {
            acc[fieldId] = null;
            return acc;
          }, {}),
        };
      }),
    });

    return operation;
  }
}
