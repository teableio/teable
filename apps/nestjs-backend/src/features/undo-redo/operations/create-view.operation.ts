import type { IViewRo, IViewVo } from '@teable/core';
import type { ICreateViewOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import { V1EngineService } from '../../../tracing/decorators/v1-engine';
import type { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import type { ViewService } from '../../view/view.service';

export interface ICreateViewPayload {
  reqParams: { tableId: string };
  reqBody: IViewRo;
  resolveData: IViewVo;
}

// Untraced host: event2Operation — Host undo-stack payload capture, not legacy execution.
@V1EngineService(['undo', 'redo'])
export class CreateViewOperation {
  constructor(
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly viewService: ViewService
  ) {}

  async event2Operation(payload: ICreateViewPayload): Promise<ICreateViewOperation> {
    return {
      name: OperationName.CreateView,
      params: {
        tableId: payload.reqParams.tableId,
      },
      result: {
        view: payload.resolveData,
      },
    };
  }

  async undo(operation: ICreateViewOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { view } = result;

    await this.viewOpenApiService.deleteView(tableId, view.id);
    return operation;
  }

  async redo(operation: ICreateViewOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { view } = result;

    await this.viewService.restoreView(tableId, view.id);

    return operation;
  }
}
