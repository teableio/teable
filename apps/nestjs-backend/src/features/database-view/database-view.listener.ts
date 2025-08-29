/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  TableCreateEvent,
  TableDeleteEvent,
  RecordDeleteEvent,
} from '../../event-emitter/events';
import type {
  FieldCreateEvent,
  FieldDeleteEvent,
  FieldUpdateEvent,
  RecordCreateEvent,
  RecordUpdateEvent,
} from '../../event-emitter/events';
import { TableDomainQueryService } from '../table-domain/table-domain-query.service';
import { DatabaseViewService } from './database-view.service';

@Injectable()
export class DatabaseViewListener {
  private logger = new Logger(DatabaseViewListener.name);
  constructor(
    private readonly databaseViewService: DatabaseViewService,
    private readonly tableDomainQueryService: TableDomainQueryService
  ) {}

  @OnEvent(Events.TABLE_CREATE)
  public async onTableCreate(payload: TableCreateEvent) {
    const table = await this.tableDomainQueryService.getTableDomainByDbTableName(
      payload.payload.table.dbTableName
    );
    await this.databaseViewService.createView(table);
  }

  @OnEvent(Events.TABLE_DELETE)
  public async onTableDelete(payload: TableDeleteEvent) {
    await this.databaseViewService.dropView(payload.payload.tableId);
  }

  @OnEvent(Events.TABLE_FIELD_DELETE)
  @OnEvent(Events.TABLE_FIELD_UPDATE)
  @OnEvent(Events.TABLE_FIELD_CREATE)
  public async recreateView(
    payload: FieldCreateEvent | FieldUpdateEvent | FieldDeleteEvent
  ): Promise<void> {
    const table = await this.tableDomainQueryService.getTableDomainById(payload.payload.tableId);
    await this.databaseViewService.recreateView(table);
  }

  @OnEvent(Events.TABLE_RECORD_CREATE)
  @OnEvent(Events.TABLE_RECORD_UPDATE)
  public async refreshOnRecordChange(payload: RecordCreateEvent | RecordUpdateEvent) {
    const { tableId } = payload.payload;
    const fieldIds = payload.getFieldIds();
    // Always include the table itself if no field ids
    if (!fieldIds.length) {
      await this.databaseViewService.refreshView(tableId);
      return;
    }
    await this.databaseViewService.refreshViewsByFieldIds(fieldIds);
  }

  @OnEvent(Events.TABLE_RECORD_DELETE)
  public async refreshOnRecordDelete(payload: RecordDeleteEvent) {
    await this.databaseViewService.refreshView(payload.payload.tableId);
  }
}
