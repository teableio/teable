/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events, TableCreateEvent, TableDeleteEvent } from '../../event-emitter/events';
import type {
  FieldCreateEvent,
  FieldDeleteEvent,
  FieldUpdateEvent,
  RecordCreateEvent,
  RecordDeleteEvent,
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

  @OnEvent(Events.TABLE_RECORD_CREATE, { async: true })
  @OnEvent(Events.TABLE_RECORD_UPDATE, { async: true })
  @OnEvent(Events.TABLE_RECORD_DELETE, { async: true })
  public async refreshOnRecordChange(
    payload: RecordCreateEvent | RecordUpdateEvent | RecordDeleteEvent
  ) {
    await this.databaseViewService.refreshView(payload.payload.tableId);
  }
}
