import type { IColumnMeta, IFieldVo, IRecord } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import { keyBy } from 'lodash';
import { OperationName } from '../../../cache/types';
import type { IPasteSelectionOperation } from '../../../cache/types';
import type { ICellContext } from '../../calculation/utils/changes';
import type { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';

export interface IPasteSelectionPayload {
  windowId: string;
  userId: string;
  tableId: string;
  updateRecords?: {
    recordIds: string[];
    fieldIds: string[];
    cellContexts: ICellContext[];
  };
  newFields?: (IFieldVo & { columnMeta?: IColumnMeta; references?: string[] })[];
  newRecords?: (IRecord & { order?: Record<string, number> })[];
}

export class PasteSelectionOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly fieldOpenApiService: FieldOpenApiService
  ) {}

  async event2Operation(payload: IPasteSelectionPayload): Promise<IPasteSelectionOperation> {
    return {
      name: OperationName.PasteSelection,
      params: {
        tableId: payload.tableId,
      },
      result: {
        updateRecords: payload.updateRecords,
        newFields: payload.newFields,
        newRecords: payload.newRecords,
      },
    };
  }

  async undo(operation: IPasteSelectionOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { updateRecords, newRecords, newFields } = result;

    if (updateRecords) {
      const { cellContexts, recordIds, fieldIds } = updateRecords;

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
      }));

      await this.recordOpenApiService.updateRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        records,
      });
    }

    if (newRecords && newRecords.length > 0) {
      await this.recordOpenApiService.deleteRecords(
        tableId,
        newRecords.map((r) => r.id)
      );
    }

    if (newFields && newFields.length > 0) {
      await this.fieldOpenApiService.deleteFields(
        tableId,
        newFields.map((field) => field.id)
      );
    }

    return operation;
  }

  async redo(operation: IPasteSelectionOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { updateRecords, newRecords, newFields } = result;

    if (newFields && newFields.length > 0) {
      await this.fieldOpenApiService.createFields(tableId, newFields);
    }

    if (newRecords && newRecords.length > 0) {
      await this.recordOpenApiService.multipleCreateRecords(params.tableId, {
        fieldKeyType: FieldKeyType.Id,
        records: newRecords,
      });
    }

    if (updateRecords) {
      const { cellContexts, recordIds, fieldIds } = updateRecords;

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
      }));

      await this.recordOpenApiService.updateRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        records,
      });
    }

    return operation;
  }
}
