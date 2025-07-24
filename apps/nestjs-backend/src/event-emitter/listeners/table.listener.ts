import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { IdPrefix, TableOpBuilder } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { isSQLite } from '../../utils/db-helpers';
import type {
  FieldCreateEvent,
  FieldDeleteEvent,
  FieldUpdateEvent,
  RecordCreateEvent,
  RecordDeleteEvent,
  RecordUpdateEvent,
  ViewCreateEvent,
  ViewDeleteEvent,
  ViewUpdateEvent,
} from '../events';
import { Events } from '../events';

type IViewEvent = ViewUpdateEvent | ViewCreateEvent | ViewDeleteEvent;
type IRecordEvent = RecordCreateEvent | RecordDeleteEvent | RecordUpdateEvent;
type IFieldEvent = FieldUpdateEvent | FieldCreateEvent | FieldDeleteEvent;
type ITableLastModifiedTimeEvent = IViewEvent | IRecordEvent | IFieldEvent;

@Injectable()
export class TableListener {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  @OnEvent('table.view.*', { async: true })
  @OnEvent('table.field.*', { async: true })
  @OnEvent('table.record.*', { async: true })
  async handleTableLastModifiedTimeEvent(event: ITableLastModifiedTimeEvent) {
    if (isSQLite(this.knex)) {
      return;
    }
    const tableId = await this.getTableId(event);
    if (!tableId) {
      return;
    }
    const lastModifiedTime = new Date().toISOString();
    const updatedTable = await this.prismaService.tableMeta.update({
      where: { id: tableId, deletedTime: null },
      data: {
        lastModifiedTime,
        version: {
          increment: 1,
        },
      },
      select: {
        baseId: true,
        lastModifiedTime: true,
        version: true,
      },
    });
    if (!updatedTable) {
      return;
    }
    const collection = `${IdPrefix.Table}_${updatedTable.baseId}`;
    const baseRaw = {
      src: this.cls.getId() || 'unknown',
      seq: 1,
      m: {
        ts: Date.now(),
      },
    };

    await this.shareDbService.publishOpsMap([
      {
        [collection]: {
          [tableId]: {
            ...baseRaw,
            op: [
              TableOpBuilder.editor.setTableProperty.build({
                key: 'lastModifiedTime',
                newValue: lastModifiedTime,
                oldValue: null,
              }),
            ],
            v: updatedTable.version - 1,
          },
        },
      },
    ]);
  }

  private async getTableId(event: ITableLastModifiedTimeEvent) {
    const { name, payload } = event;
    switch (name) {
      case Events.TABLE_VIEW_UPDATE:
      case Events.TABLE_VIEW_CREATE:
      case Events.TABLE_VIEW_DELETE:
        return payload.tableId;
      case Events.TABLE_FIELD_UPDATE:
      case Events.TABLE_FIELD_CREATE:
      case Events.TABLE_FIELD_DELETE:
        return payload.tableId;
      case Events.TABLE_RECORD_UPDATE:
      case Events.TABLE_RECORD_CREATE:
      case Events.TABLE_RECORD_DELETE:
        return payload.tableId;
      default:
        return null;
    }
  }
}
