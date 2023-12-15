import type { IRecord } from '@teable-group/core';
import { Expose } from 'class-transformer';
import { RawOpType } from '../../../share-db/interface';
import type { IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';
import type { IChangeValue } from './base-op-event';
import { BaseOpEvent } from './base-op-event';

type IEventName = Extract<
  Events,
  Events.TABLE_RECORD_CREATE | Events.TABLE_RECORD_DELETE | Events.TABLE_RECORD_UPDATE
>;

export type IChangeRecord = Record<
  keyof Pick<IRecord, 'fields' | 'recordOrder'>,
  Record<string, IChangeValue>
> & {
  id: string;
};

export class RecordCreateEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_RECORD_CREATE;
  @Expose() tableId: string;
  @Expose() record: IRecord | IRecord[] | undefined;

  constructor(tableId: string, record: IRecord | IRecord[] | undefined, context: IEventContext) {
    super(RawOpType.Create, Array.isArray(record), context);

    this.tableId = tableId;
    this.record = record;
    this.context = context;
  }
}

export class RecordDeleteEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_RECORD_DELETE;
  @Expose() tableId: string;
  @Expose() recordId: string | string[] | undefined;

  constructor(tableId: string, recordId: string | string[] | undefined, context: IEventContext) {
    super(RawOpType.Del, Array.isArray(recordId), context);

    this.tableId = tableId;
    this.recordId = recordId;
    this.context = context;
  }
}

export class RecordUpdateEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_RECORD_UPDATE;
  @Expose() tableId: string;
  @Expose() record: IChangeRecord | IChangeRecord[] | undefined;

  constructor(
    tableId: string,
    record: IChangeRecord | IChangeRecord[] | undefined,
    context: IEventContext
  ) {
    super(RawOpType.Edit, Array.isArray(record), context);

    this.tableId = tableId;
    this.record = record;
  }
}
