import { FieldKeyType } from '@teable/core';
import { keyBy } from 'lodash';
import type { IUpdateRecordsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { ICellContext } from '../../calculation/utils/changes';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { RecordService } from '../../record/record.service';

export interface IUpdateRecordsPayload {
  windowId: string;
  tableId: string;
  userId: string;
  recordIds: string[];
  fieldIds: string[];
  cellContexts: ICellContext[];
}

export class UpdateRecordsOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService
  ) {}

  async event2Operation(payload: IUpdateRecordsPayload): Promise<IUpdateRecordsOperation> {
    const { tableId, recordIds, fieldIds, cellContexts } = payload;
    return {
      name: OperationName.UpdateRecords,
      params: {
        tableId,
        recordIds,
        fieldIds,
      },
      result: {
        cellContexts,
      },
    };
  }

  // TODO: filter out fields that are not in the record, filter out computed fields
  async undo(operation: IUpdateRecordsOperation) {
    const { params, result } = operation;
    const { tableId, recordIds, fieldIds } = params;
    const { cellContexts } = result;

    const cellContextMap = keyBy(
      cellContexts,
      (cellContext) => `${cellContext.recordId}-${cellContext.fieldId}`
    );

    await this.recordOpenApiService.updateRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: recordIds.map((recordId) => ({
        id: recordId,
        fields: fieldIds.reduce<Record<string, unknown>>((acc, fieldId) => {
          const key = `${recordId}-${fieldId}`;
          const cellContext = cellContextMap[key];
          if (cellContext) {
            acc[fieldId] = cellContext.oldValue == null ? null : cellContext.oldValue;
          }
          return acc;
        }, {}),
      })),
    });

    return operation;
  }

  async redo(operation: IUpdateRecordsOperation) {
    const { params, result } = operation;
    const { tableId, recordIds, fieldIds } = params;
    const { cellContexts } = result;

    const cellContextMap = keyBy(
      cellContexts,
      (cellContext) => `${cellContext.recordId}-${cellContext.fieldId}`
    );

    await this.recordOpenApiService.updateRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: recordIds.map((recordId) => ({
        id: recordId,
        fields: fieldIds.reduce<Record<string, unknown>>((acc, fieldId) => {
          const key = `${recordId}-${fieldId}`;
          const cellContext = cellContextMap[key];
          if (cellContext) {
            acc[fieldId] = cellContext.newValue == null ? null : cellContext.newValue;
          }
          return acc;
        }, {}),
      })),
    });

    return operation;
  }
}
