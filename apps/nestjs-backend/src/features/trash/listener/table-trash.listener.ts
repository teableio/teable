import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { generateRecordTrashId } from '@teable/core';
import { ResourceType } from '@teable/openapi';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { Events } from '../../../event-emitter/events';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import { IDeleteFieldsPayload } from '../../undo-redo/operations/delete-fields.operation';
import { IDeleteRecordsPayload } from '../../undo-redo/operations/delete-records.operation';
import { IDeleteViewPayload } from '../../undo-redo/operations/delete-view.operation';

type ITableTrashDataPrisma = {
  tableTrash: {
    create(args: unknown): PromiseLike<unknown>;
  };
  recordTrash: {
    createMany(args: unknown): PromiseLike<unknown>;
  };
};

type IScopedTableTrashDataPrisma = ITableTrashDataPrisma & {
  txClient?: () => ITableTrashDataPrisma;
  $tx?: <T>(
    fn: (prisma: ITableTrashDataPrisma) => Promise<T>,
    options?: { timeout?: number }
  ) => Promise<T>;
  $transaction?: <T>(
    fn: (prisma: ITableTrashDataPrisma) => Promise<T>,
    options?: { timeout?: number }
  ) => Promise<T>;
};

@Injectable()
export class TableTrashListener {
  constructor(
    private readonly dataDbClientManager: DataDbClientManager,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  private getDataPrismaExecutor(prisma: IScopedTableTrashDataPrisma): ITableTrashDataPrisma {
    return prisma.txClient?.() ?? prisma;
  }

  private async dataPrismaForTable(tableId: string): Promise<IScopedTableTrashDataPrisma> {
    return (await this.dataDbClientManager.dataPrismaForTable(tableId, {
      useTransaction: true,
    })) as IScopedTableTrashDataPrisma;
  }

  private async dataPrismaTransactionForTable<T>(
    tableId: string,
    fn: (prisma: ITableTrashDataPrisma) => Promise<T>,
    options?: { timeout?: number }
  ): Promise<T> {
    const prisma = await this.dataPrismaForTable(tableId);

    if (prisma.$tx) {
      return await prisma.$tx(fn, options);
    }

    if (prisma.$transaction) {
      return await prisma.$transaction(fn, options);
    }

    return await fn(this.getDataPrismaExecutor(prisma));
  }

  @OnEvent(Events.OPERATION_RECORDS_DELETE)
  async recordDeleteListener(payload: IDeleteRecordsPayload) {
    const { operationId, userId, tableId, records } = payload;

    if (!operationId) return;

    const recordIds = records.map((record) => record.id);
    const createdTime = new Date();

    await this.dataPrismaTransactionForTable(
      tableId,
      async (prisma) => {
        await prisma.tableTrash.create({
          data: {
            id: operationId,
            tableId,
            createdBy: userId,
            resourceType: ResourceType.Record,
            snapshot: JSON.stringify(recordIds),
            createdTime,
          },
        });

        const batchSize = 5000;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          await prisma.recordTrash.createMany({
            data: batch.map((record) => ({
              id: generateRecordTrashId(),
              tableId,
              recordId: record.id,
              snapshot: JSON.stringify(record),
              createdBy: userId,
              createdTime,
            })),
          });
        }
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  @OnEvent(Events.OPERATION_FIELDS_DELETE, { async: true })
  async fieldDeleteListener(payload: IDeleteFieldsPayload) {
    const { userId, tableId, fields, records, operationId } = payload;

    if (!operationId) return;

    const dataPrisma = this.getDataPrismaExecutor(await this.dataPrismaForTable(tableId));

    await dataPrisma.tableTrash.create({
      data: {
        id: operationId,
        tableId,
        createdBy: userId,
        resourceType: ResourceType.Field,
        snapshot: JSON.stringify({ fields, records }),
      },
    });
  }

  @OnEvent(Events.OPERATION_VIEW_DELETE, { async: true })
  async viewDeleteListener(payload: IDeleteViewPayload) {
    const { operationId, tableId, viewId, userId } = payload;

    if (!operationId) return;

    const dataPrisma = this.getDataPrismaExecutor(await this.dataPrismaForTable(tableId));

    await dataPrisma.tableTrash.create({
      data: {
        id: operationId,
        tableId,
        createdBy: userId,
        resourceType: ResourceType.View,
        snapshot: JSON.stringify([viewId]),
      },
    });
  }
}
