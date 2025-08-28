import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
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
  private readonly logger = new Logger(TableListener.name);

  constructor(
    private readonly prismaService: PrismaService,
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
    await this.prismaService.tableMeta.update({
      where: { id: tableId, deletedTime: null },
      data: {
        lastModifiedTime: new Date().toISOString(),
      },
    });
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
