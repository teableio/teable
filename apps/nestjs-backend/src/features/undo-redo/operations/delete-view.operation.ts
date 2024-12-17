import type { PrismaService } from '@teable/db-main-prisma';
import type { IDeleteViewOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import type { ViewService } from '../../view/view.service';

export interface IDeleteViewPayload {
  operationId: string;
  windowId: string;
  tableId: string;
  viewId: string;
  userId: string;
}

export class DeleteViewOperation {
  constructor(
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly viewService: ViewService,
    private readonly prismaService: PrismaService
  ) {}

  async event2Operation(payload: IDeleteViewPayload): Promise<IDeleteViewOperation> {
    return {
      name: OperationName.DeleteView,
      params: {
        tableId: payload.tableId,
        viewId: payload.viewId,
      },
      operationId: payload.operationId,
    };
  }

  async undo(operation: IDeleteViewOperation) {
    const { params, operationId = '' } = operation;
    const { tableId, viewId } = params;

    const count = await this.prismaService.tableTrash.count({
      where: { id: operationId },
    });

    if (operationId && Number(count) === 0) return operation;

    await this.prismaService.$tx(async (prisma) => {
      await this.viewService.restoreView(tableId, viewId);
      await prisma.tableTrash.delete({
        where: { id: operationId },
      });
    });
    return operation;
  }

  async redo(operation: IDeleteViewOperation) {
    const { params } = operation;
    const { tableId, viewId } = params;

    await this.viewOpenApiService.deleteView(tableId, viewId);
    return operation;
  }
}
