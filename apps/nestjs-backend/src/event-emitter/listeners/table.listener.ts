import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { TableService } from '../../features/table/table.service';
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
    private readonly tableService: TableService,
    private readonly prismaService: PrismaService,
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
    await this.cls.runWith(
      {
        ...this.cls.get(),
        tx: {},
      },
      async () => {
        await this.prismaService.$tx(async () => {
          const tableId = await this.getTableId(event);
          if (!tableId) {
            return;
          }
          const table = await this.prismaService.txClient().tableMeta.findUnique({
            where: { id: tableId, deletedTime: null },
          });
          if (!table) {
            return;
          }
          await this.tableService.updateTable(table.baseId, tableId, {});
        });
      }
    );
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
