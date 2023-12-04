import type { ITableFullVo } from '@teable-group/core';
import { ITableOp } from '@teable-group/core';
import { Expose } from 'class-transformer';
import { AbstractEvent } from '../../abstract/event.abstract';
import { IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';

type IEventName = Extract<Events, Events.TABLE_CREATE | Events.TABLE_DELETE | Events.TABLE_UPDATE>;

export class TableCreateEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_CREATE;
  @Expose() context: IEventContext;
  @Expose() baseId: string;
  @Expose() table: ITableOp;

  constructor(baseId: string, table: ITableOp, context: IEventContext) {
    super();
    this.baseId = baseId;
    this.table = table;
    this.context = context;
  }
}

@Expose()
export class TableDeleteEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_DELETE;
  context: IEventContext;
  baseId: string;
  tableId: string;

  constructor(baseId: string, tableId: string, context: IEventContext) {
    super();
    this.baseId = baseId;
    this.tableId = tableId;
    this.context = context;
  }
}

@Expose()
export class TableUpdateEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_UPDATE;
  context: IEventContext;
  baseId: string;
  table: Pick<ITableOp, 'name'>;

  // eslint-disable-next-line sonarjs/no-identical-functions
  constructor(baseId: string, table: Pick<ITableFullVo, 'name'>, context: IEventContext) {
    super();
    this.baseId = baseId;
    this.table = table;
    this.context = context;
  }
}
