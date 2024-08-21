import { FieldKeyType } from '@teable/core';
import type { IRecord } from '@teable/openapi';
import { keyBy } from 'lodash';
import type { IUpdateRecordOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { ICellContext } from '../../calculation/link.service';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { RecordService } from '../../record/record.service';

export interface IUpdateRecordPayload {
  tableId: string;
  recordId: string;
  record: IRecord;
  userId: string;
  windowId: string;
  cellContexts: ICellContext[];
}

export class UpdateRecordOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService
  ) {}

  async event2Operation(payload: IUpdateRecordPayload): Promise<IUpdateRecordOperation> {
    const { tableId, recordId, record } = payload;

    const fieldIds = Object.keys(record.fields);
    const cellContextsMap = keyBy(payload.cellContexts, 'fieldId');

    const recordFieldsBefore = fieldIds.reduce<Record<string, unknown>>((acc, fieldId) => {
      acc[fieldId] = cellContextsMap[fieldId]?.oldValue || null;
      return acc;
    }, {});

    const recordFieldsAfter = fieldIds.reduce<Record<string, unknown>>((acc, fieldId) => {
      acc[fieldId] = record.fields[fieldId];
      return acc;
    }, {});

    return {
      name: OperationName.UpdateRecord,
      params: {
        tableId,
        recordId,
      },
      result: {
        before: recordFieldsBefore,
        after: recordFieldsAfter,
      },
    };
  }

  // TODO: filter out fields that are not in the record
  async undo(operation: IUpdateRecordOperation) {
    const { params, result } = operation;

    await this.recordOpenApiService.updateRecord(params.tableId, params.recordId, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: result.before,
      },
    });

    return operation;
  }

  async redo(operation: IUpdateRecordOperation) {
    const { params, result } = operation;

    await this.recordOpenApiService.updateRecord(params.tableId, params.recordId, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: result.after,
      },
    });

    return operation;
  }
}
