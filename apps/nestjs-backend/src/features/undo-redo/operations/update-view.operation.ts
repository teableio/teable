import type { IOtOperation, IViewPropertyKeys } from '@teable/core';
import Sharedb from 'sharedb';
import type { IUpdateViewOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { ViewOpenApiService } from '../../view/open-api/view-open-api.service';

export interface IUpdateViewPayload {
  tableId: string;
  windowId: string;
  viewId: string;
  userId: string;
  byKey?: {
    key: IViewPropertyKeys;
    newValue: unknown;
    oldValue: unknown;
  };
  byOps?: IOtOperation[];
}

export class UpdateViewOperation {
  constructor(private readonly viewOpenApiService: ViewOpenApiService) {}

  async event2Operation(payload: IUpdateViewPayload): Promise<IUpdateViewOperation> {
    const { byKey, byOps } = payload;
    return {
      name: OperationName.UpdateView,
      params: {
        tableId: payload.tableId,
        viewId: payload.viewId,
      },
      result: {
        byKey,
        byOps,
      },
    };
  }

  async undo(operation: IUpdateViewOperation) {
    const { params, result } = operation;
    const { tableId, viewId } = params;
    const { byKey, byOps } = result;

    if (byKey) {
      const { key, oldValue } = byKey;
      await this.viewOpenApiService.setViewProperty(tableId, viewId, key, oldValue);
    }

    if (byOps) {
      await this.viewOpenApiService.updateViewByOps(
        tableId,
        viewId,
        Sharedb.types.map['json0'].invert?.(byOps)
      );
    }

    return operation;
  }

  async redo(operation: IUpdateViewOperation) {
    const { params, result } = operation;
    const { tableId, viewId } = params;
    const { byKey, byOps } = result;

    if (byKey) {
      const { key, newValue } = byKey;
      await this.viewOpenApiService.setViewProperty(tableId, viewId, key, newValue);
    }

    if (byOps) {
      await this.viewOpenApiService.updateViewByOps(tableId, viewId, byOps);
    }

    return operation;
  }
}
