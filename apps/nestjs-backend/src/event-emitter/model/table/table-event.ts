import { ITableOp } from '@teable-group/core';
import { Expose } from 'class-transformer';
import { RawOpType } from '../../../share-db/interface';
import type { IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';
import type { IChangeValue } from './base-op-event';
import { BaseOpEvent } from './base-op-event';

type IEventName = Extract<Events, Events.TABLE_CREATE | Events.TABLE_DELETE | Events.TABLE_UPDATE>;

export type IChangeTable = Record<keyof Omit<ITableOp, 'id' | 'lastModifiedTime'>, IChangeValue> & {
  id: string;
};

export class TableCreateEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_CREATE;
  @Expose() baseId: string;
  @Expose() table: ITableOp;

  constructor(baseId: string, table: ITableOp, context: IEventContext) {
    super(RawOpType.Create, false, context);

    this.baseId = baseId;
    this.table = table;
  }
}

export class TableDeleteEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_DELETE;
  @Expose() baseId: string;
  @Expose() tableId: string;

  constructor(baseId: string, tableId: string, context: IEventContext) {
    super(RawOpType.Del, false, context);

    this.baseId = baseId;
    this.tableId = tableId;
  }
}

export class TableUpdateEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_UPDATE;
  @Expose() baseId: string;
  @Expose() table: IChangeTable;

  constructor(baseId: string, table: IChangeTable, context: IEventContext) {
    super(RawOpType.Edit, false, context);

    this.baseId = baseId;
    this.table = table;
  }
}
