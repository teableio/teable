import type { IUpdateRecordsOrderOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { ViewOpenApiService } from '../../view/open-api/view-open-api.service';

export interface IUpdateRecordsOrderPayload {
  windowId: string;
  tableId: string;
  viewId: string;
  userId: string;
  recordIds: string[];
  orderIndexesBefore?: Record<string, number>[];
  orderIndexesAfter?: Record<string, number>[];
}

export class UpdateRecordsOrderOperation {
  constructor(private readonly viewOpenApiService: ViewOpenApiService) {}

  async event2Operation(
    payload: IUpdateRecordsOrderPayload
  ): Promise<IUpdateRecordsOrderOperation> {
    const { tableId, viewId, recordIds, orderIndexesAfter, orderIndexesBefore } = payload;

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
      name: OperationName.UpdateRecordsOrder,
      params: {
        tableId,
        viewId,
        recordIds,
      },
      result: {
        ordersMap,
      },
    };
  }

  // TODO: filter out fields that are not in the record, filter out computed fields
  async undo(operation: IUpdateRecordsOrderOperation) {
    const { params, result } = operation;
    const { tableId, viewId, recordIds } = params;
    const { ordersMap } = result;

    const records = recordIds.map((recordId) => ({
      id: recordId,
      order: ordersMap?.[recordId]?.oldOrder,
    }));
    await this.viewOpenApiService.updateRecordIndexes(tableId, viewId, records);
    return operation;
  }

  async redo(operation: IUpdateRecordsOrderOperation) {
    const { params, result } = operation;
    const { tableId, viewId, recordIds } = params;
    const { ordersMap } = result;

    const records = recordIds.map((recordId) => ({
      id: recordId,
      order: ordersMap?.[recordId]?.newOrder,
    }));
    await this.viewOpenApiService.updateRecordIndexes(tableId, viewId, records);
    return operation;
  }
}
