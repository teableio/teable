import type { IRecord } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import type { DataPrismaService } from '@teable/db-data-prisma';
import type { IDeleteRecordsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { IThresholdConfig } from '../../../configs/threshold.config';
import type { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';

export interface IDeleteRecordsPayload {
  operationId: string;
  windowId?: string;
  tableId: string;
  userId: string;
  records: (IRecord & { version?: number; order?: Record<string, number> })[];
}

export class DeleteRecordsOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly thresholdConfig: IThresholdConfig,
    private readonly dataDbClientManager: DataDbClientManager
  ) {}

  private async dataPrismaForTable(tableId: string): Promise<DataPrismaService> {
    return (await this.dataDbClientManager.dataPrismaForTable(tableId, {
      useTransaction: true,
    })) as DataPrismaService;
  }

  private async dataPrismaExecutorForTable(tableId: string): Promise<DataPrismaService> {
    const dataPrisma = await this.dataPrismaForTable(tableId);
    return (dataPrisma.txClient?.() ?? dataPrisma) as DataPrismaService;
  }

  private async dataPrismaTransactionForTable<T>(
    tableId: string,
    fn: (prisma: DataPrismaService) => Promise<T>
  ): Promise<T> {
    const dataPrisma = await this.dataPrismaForTable(tableId);

    if (dataPrisma.$tx) {
      return await dataPrisma.$tx(fn as never, {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      });
    }

    if (dataPrisma.$transaction) {
      return await dataPrisma.$transaction(fn as never, {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      });
    }

    return await fn((dataPrisma.txClient?.() ?? dataPrisma) as DataPrismaService);
  }

  async event2Operation(payload: IDeleteRecordsPayload): Promise<IDeleteRecordsOperation> {
    return {
      name: OperationName.DeleteRecords,
      params: {
        tableId: payload.tableId,
      },
      result: {
        records: payload.records,
      },
      operationId: payload.operationId,
    };
  }

  async undo(operation: IDeleteRecordsOperation) {
    const { params, result, operationId = '' } = operation;
    const dataPrisma = await this.dataPrismaExecutorForTable(params.tableId);

    const count = await dataPrisma.tableTrash.count({
      where: { id: operationId },
    });

    if (operationId && Number(count) === 0) return operation;

    await this.recordOpenApiService.multipleCreateRecords(params.tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: result.records,
    });

    if (operationId) {
      const recordIds = result.records.map((record) => record.id);

      await this.dataPrismaTransactionForTable(params.tableId, async (prisma) => {
        await prisma.tableTrash.delete({
          where: { id: operationId },
        });
        await prisma.recordTrash.deleteMany({
          where: {
            tableId: params.tableId,
            recordId: { in: recordIds },
          },
        });
      });
    }

    return operation;
  }

  async redo(operation: IDeleteRecordsOperation) {
    const { params, result } = operation;
    const { tableId } = params;

    await this.recordOpenApiService.deleteRecords(
      tableId,
      result.records.map((record) => record.id)
    );

    return operation;
  }
}
