import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { generateRecordTrashId } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import { ResourceType } from '@teable/openapi';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { Events } from '../../../event-emitter/events';
import { IDeleteFieldsPayload } from '../../undo-redo/operations/delete-fields.operation';
import { IDeleteRecordsPayload } from '../../undo-redo/operations/delete-records.operation';
import { IDeleteViewPayload } from '../../undo-redo/operations/delete-view.operation';

@Injectable()
export class TableTrashListener {
  constructor(
    private readonly dataPrismaService: DataPrismaService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  @OnEvent(Events.OPERATION_RECORDS_DELETE)
  async recordDeleteListener(payload: IDeleteRecordsPayload) {
    const { operationId, userId, tableId, records } = payload;

    if (!operationId) return;

    const recordIds = records.map((record) => record.id);
    const createdTime = new Date();

    await this.dataPrismaService.$tx(
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

    await this.dataPrismaService.tableTrash.create({
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

    await this.dataPrismaService.tableTrash.create({
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
