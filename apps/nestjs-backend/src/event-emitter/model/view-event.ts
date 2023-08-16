import type { IOpContextBase } from '@teable-group/core';
import { EventAbstract } from '../abstract/event.abstract';
import { EventEnums } from './event.enum';

type IEventName = Extract<EventEnums, EventEnums.ViewCreated | EventEnums.ViewUpdated>;

export class ViewCreatedEvent extends EventAbstract {
  eventName: IEventName = EventEnums.ViewCreated;
  tableId!: string;
  viewId!: string;
  ops?: IOpContextBase[];

  constructor(tableId: string, viewId: string, ops: IOpContextBase[]) {
    super();
    this.tableId = tableId;
    this.viewId = viewId;
    this.ops = ops;
  }
}

export class ViewUpdatedEvent extends ViewCreatedEvent {
  eventName: IEventName = EventEnums.ViewUpdated;
  ops!: IOpContextBase[];

  constructor(tableId: string, viewId: string, ops: IOpContextBase[]) {
    super(tableId, viewId, ops);
    this.ops = ops;
  }
}
