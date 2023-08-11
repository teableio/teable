import type { IOpContextBase } from '@teable-group/core';
import { EventAbstract } from './abstract/event.abstract';
import { EventEnums } from './event.enum';

type IEventName = Extract<EventEnums, EventEnums.RecordCreated | EventEnums.RecordUpdated>;

export class RecordCreatedEvent extends EventAbstract {
  eventName: IEventName = EventEnums.RecordCreated;
  tableId!: string;
  recordId!: string;
  snapshot!: unknown;

  constructor(tableId: string, recordId: string, snapshot: unknown) {
    super();
    this.tableId = tableId;
    this.recordId = recordId;
    this.snapshot = snapshot;
  }
}

export class RecordUpdatedEvent extends RecordCreatedEvent {
  eventName: IEventName = EventEnums.RecordUpdated;
  ops!: IOpContextBase[];

  constructor(tableId: string, recordId: string, snapshot: unknown, ops: IOpContextBase[]) {
    super(tableId, recordId, snapshot);
    this.ops = ops;
  }
}
