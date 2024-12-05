import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { generateRecordTrashId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ResourceType } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { Events } from '../../../event-emitter/events';
import { IDeleteFieldsPayload } from '../../undo-redo/operations/delete-fields.operation';
import { IDeleteRecordsPayload } from '../../undo-redo/operations/delete-records.operation';
import { IDeleteViewPayload } from '../../undo-redo/operations/delete-view.operation';

@Injectable()
export class TableTrashListener {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  @OnEvent(Events.OPERATION_RECORDS_DELETE, { async: true })
  async recordDeleteListener(payload: IDeleteRecordsPayload) {
    const { operationId, userId, tableId, records } = payload;

    if (!operationId) return;

    const recordIds = records.map((record) => record.id);

    await this.prismaService.$tx(
      async (prisma) => {
        await prisma.tableTrash.create({
          data: {
            id: operationId,
            tableId,
            createdBy: userId,
            resourceType: ResourceType.Record,
            snapshot: JSON.stringify(recordIds),
          },
        });

        const batchSize = 5000;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          const recordTrashData = batch.map((record) => ({
            id: generateRecordTrashId(),
            table_id: tableId,
            record_id: record.id,
            snapshot: JSON.stringify(record),
            created_by: userId,
          }));

          const query = this.knex.insert(recordTrashData).into('record_trash').toQuery();
          await prisma.$executeRawUnsafe(query);
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

    await this.prismaService.tableTrash.create({
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

    await this.prismaService.tableTrash.create({
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
