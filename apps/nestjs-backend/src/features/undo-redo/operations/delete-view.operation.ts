import type { DataPrismaService } from '@teable/db-data-prisma';
import type { IDeleteViewOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import type { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import type { ViewService } from '../../view/view.service';

export interface IDeleteViewPayload {
  operationId: string;
  windowId: string;
  tableId: string;
  viewId: string;
  userId: string;
}

type IScopedDataPrismaService = DataPrismaService & {
  txClient?: () => DataPrismaService;
};

export class DeleteViewOperation {
  constructor(
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly viewService: ViewService,
    private readonly dataDbClientManager: DataDbClientManager
  ) {}

  private async dataPrismaForTable(tableId: string): Promise<DataPrismaService> {
    const dataPrisma = (await this.dataDbClientManager.dataPrismaForTable(tableId, {
      useTransaction: true,
    })) as IScopedDataPrismaService;
    return (dataPrisma.txClient?.() ?? dataPrisma) as DataPrismaService;
  }

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
    const dataPrisma = await this.dataPrismaForTable(tableId);

    const count = await dataPrisma.tableTrash.count({
      where: { id: operationId },
    });

    if (operationId && Number(count) === 0) return operation;

    await this.viewService.restoreView(tableId, viewId);

    if (operationId) {
      await dataPrisma.tableTrash.delete({
        where: { id: operationId },
      });
    }
    return operation;
  }

  async redo(operation: IDeleteViewOperation) {
    const { params } = operation;
    const { tableId, viewId } = params;

    await this.viewOpenApiService.deleteView(tableId, viewId);
    return operation;
  }
}
