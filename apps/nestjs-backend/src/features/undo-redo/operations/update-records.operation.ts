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
  orderIndexesBefore?: Record<string, number>[];
  orderIndexesAfter?: Record<string, number>[];
}

export class UpdateRecordsOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService
  ) {}

  async event2Operation(payload: IUpdateRecordsPayload): Promise<IUpdateRecordsOperation> {
    const { tableId, recordIds, fieldIds, cellContexts, orderIndexesAfter, orderIndexesBefore } =
      payload;

    const ordersMap = recordIds.reduce<{
      [recordId: string]: {
        newOrder?: Record<string, number>;
        oldOrder?: Record<string, number>;
      };
    }>((acc, recordId, index) => {
      if (orderIndexesAfter?.[index] == orderIndexesBefore?.[index]) {
        return acc;
      }

      acc[recordId] = {
        newOrder: orderIndexesAfter?.[index],
        oldOrder: orderIndexesBefore?.[index],
      };
      return acc;
    }, {});

    return {
      name: OperationName.UpdateRecords,
      params: {
        tableId,
        recordIds,
        fieldIds,
      },
      result: {
        cellContexts,
        ordersMap,
      },
    };
  }

  // TODO: filter out fields that are not in the record, filter out computed fields
  async undo(operation: IUpdateRecordsOperation) {
    const { params, result } = operation;
    const { tableId, recordIds, fieldIds } = params;
    const { cellContexts, ordersMap } = result;

    const cellContextMap = keyBy(
      cellContexts,
      (cellContext) => `${cellContext.recordId}-${cellContext.fieldId}`
    );

    const records = recordIds.map((recordId) => ({
      id: recordId,
      fields: fieldIds.reduce<Record<string, unknown>>((acc, fieldId) => {
        const key = `${recordId}-${fieldId}`;
        const cellContext = cellContextMap[key];
        if (cellContext) {
          acc[fieldId] = cellContext.oldValue == null ? null : cellContext.oldValue;
        }
        return acc;
      }, {}),
      order: ordersMap?.[recordId]?.oldOrder,
    }));

    await this.recordService.updateRecordIndexes(tableId, records);

    await this.recordOpenApiService.updateRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records,
    });

    return operation;
  }

  async redo(operation: IUpdateRecordsOperation) {
    const { params, result } = operation;
    const { tableId, recordIds, fieldIds } = params;
    const { cellContexts, ordersMap } = result;

    const cellContextMap = keyBy(
      cellContexts,
      (cellContext) => `${cellContext.recordId}-${cellContext.fieldId}`
    );

    const records = recordIds.map((recordId) => ({
      id: recordId,
      fields: fieldIds.reduce<Record<string, unknown>>((acc, fieldId) => {
        const key = `${recordId}-${fieldId}`;
        const cellContext = cellContextMap[key];
        if (cellContext) {
          acc[fieldId] = cellContext.newValue == null ? null : cellContext.newValue;
        }
        return acc;
      }, {}),
      order: ordersMap?.[recordId]?.newOrder,
    }));

    await this.recordService.updateRecordIndexes(tableId, records);

    await this.recordOpenApiService.updateRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records,
    });

    return operation;
  }
}
