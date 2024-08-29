import type { IDeleteViewOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import type { ViewService } from '../../view/view.service';

export interface IDeleteViewPayload {
  reqParams: { tableId: string; viewId: string };
}

export class DeleteViewOperation {
  constructor(
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly viewService: ViewService
  ) {}

  async event2Operation(payload: IDeleteViewPayload): Promise<IDeleteViewOperation> {
    return {
      name: OperationName.DeleteView,
      params: {
        tableId: payload.reqParams.tableId,
        viewId: payload.reqParams.viewId,
      },
    };
  }

  async undo(operation: IDeleteViewOperation) {
    const { params } = operation;
    const { tableId, viewId } = params;

    await this.viewService.restoreView(tableId, viewId);
    return operation;
  }

  async redo(operation: IDeleteViewOperation) {
    const { params } = operation;
    const { tableId, viewId } = params;

    await this.viewOpenApiService.deleteView(tableId, viewId);
    return operation;
  }
}
