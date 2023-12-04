import { IRecord } from '@teable-group/core';
import { Expose } from 'class-transformer';
import { AbstractEvent } from '../../abstract/event.abstract';
import { IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';

type IEventName = Extract<
  Events,
  Events.TABLE_RECORD_CREATE | Events.TABLE_RECORD_DELETE | Events.TABLE_RECORD_UPDATE
>;

export class RecordCreateEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_RECORD_CREATE;
  @Expose() context: IEventContext;
  @Expose() tableId: string;
  @Expose() record: IRecord;

  constructor(tableId: string, record: IRecord, context: IEventContext) {
    super();
    this.tableId = tableId;
    this.record = record;
    this.context = context;
  }
}

@Expose()
export class RecordDeleteEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_RECORD_DELETE;
  @Expose() context: IEventContext;
  @Expose() tableId: string;
  @Expose() recordId: string;

  constructor(tableId: string, recordId: string, context: IEventContext) {
    super();
    this.tableId = tableId;
    this.recordId = recordId;
    this.context = context;
  }
}

export class RecordUpdateEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_RECORD_UPDATE;
  @Expose() context: IEventContext;
  @Expose() tableId: string;
  @Expose() recordId: string;
  @Expose() oldFields: Record<string, unknown>;
  @Expose() newFields: Record<string, unknown>;

  constructor(
    tableId: string,
    recordId: string,
    oldFields: Record<string, unknown>,
    newFields: Record<string, unknown>,
    context: IEventContext
  ) {
    super();
    this.tableId = tableId;
    this.recordId = recordId;
    this.oldFields = oldFields;
    this.newFields = newFields;
    this.context = context;
  }
}
