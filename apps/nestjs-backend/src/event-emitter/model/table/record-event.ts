import type { IRecord } from '@teable-group/core';
import { Expose } from 'class-transformer';
import { RawOpType } from '../../../share-db/interface';
import type { IBaseEvent } from '../../interfaces/base-event.interface';
import { IEventContext } from '../../interfaces/base-event.interface';
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
  @Expose() viewId: string | undefined;
  @Expose() record: IRecord | IRecord[] | undefined;

  constructor(
    tableId: string,
    viewId: string | undefined,
    record: IRecord | IRecord[] | undefined,
    context: IEventContext
  ) {
    super(RawOpType.Create, record && Array.isArray(record), context);

    this.tableId = tableId;
    this.record = record;
    this.viewId = viewId;
    this.context = context;
  }
}

@Expose()
export class RecordDeleteEvent implements IBaseEvent {
  name: IEventName = Events.TABLE_RECORD_DELETE;
  @Expose() context: IEventContext;
  @Expose() tableId: string;
  @Expose() recordId: string;

  constructor(tableId: string, recordId: string, context: IEventContext) {
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
    super(RawOpType.Edit, record && Array.isArray(record), context);
    this.tableId = tableId;
    this.record = record;
  }
}
