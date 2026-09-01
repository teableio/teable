import type { IRecord } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import type { DataPrismaService } from '@teable/db-data-prisma';
import type { IRecordRemovalReason } from '@teable/v2-core';
import type { IDeleteRecordsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { IThresholdConfig } from '../../../configs/threshold.config';
import type { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { RecordRemovalTombstoneService } from '../../record-removal-cold/record-removal-tombstone.service';

export type { IRecordRemovalReason };

export interface IDeleteRecordsPayload {
  operationId: string;
  windowId?: string;
  tableId: string;
  userId: string;
  records: (IRecord & { version?: number; order?: Record<string, number> })[];
  // 'archived' removals persist their own snapshot before deleting; trash sinks skip them.
  removalReason?: IRecordRemovalReason;
}

export class DeleteRecordsOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly thresholdConfig: IThresholdConfig,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly recordRemovalTombstoneService: RecordRemovalTombstoneService
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
            reason: 'deleted',
          },
        });
      });

      // Cold-copy suppression: a trash row already uploaded to a cold part (flush
      // overlap window) outlives the deleteMany above and would resurface in
      // merged reads once the buffer drains.
      await this.recordRemovalTombstoneService.markRestored(
        await this.dataPrismaExecutorForTable(params.tableId),
        params.tableId,
        recordIds
      );
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
