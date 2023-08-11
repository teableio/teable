import type { IOpContextBase } from '@teable-group/core';
import { EventAbstract } from './abstract/event.abstract';
import { EventEnums } from './event.enum';

type IEventName = Extract<EventEnums, EventEnums.ViewCreated | EventEnums.ViewUpdated>;

export class ViewCreatedEvent extends EventAbstract {
  eventName: IEventName = EventEnums.ViewCreated;
  tableId!: string;
  viewId!: string;
  snapshot!: unknown;

  constructor(tableId: string, viewId: string, snapshot: unknown) {
    super();
    this.tableId = tableId;
    this.viewId = viewId;
    this.snapshot = snapshot;
  }
}

export class ViewUpdatedEvent extends ViewCreatedEvent {
  eventName: IEventName = EventEnums.ViewUpdated;
  ops!: IOpContextBase[];

  constructor(tableId: string, viewId: string, snapshot: unknown, ops: IOpContextBase[]) {
    super(tableId, viewId, snapshot);
    this.ops = ops;
  }
}
