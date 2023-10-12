import type { IOpContextBase } from '@teable-group/core';
import { EventAbstract } from '../abstract/event.abstract';
import { EventEnums } from './event.enum';

type IEventName = Extract<
  EventEnums,
  EventEnums.RecordCreated | EventEnums.RecordUpdated | EventEnums.RecordDeleted
>;

export class RecordCreatedEvent extends EventAbstract {
  eventName: IEventName = EventEnums.RecordCreated;
  tableId!: string;
  recordId!: string;
  ops?: IOpContextBase[];

  constructor(tableId: string, recordId: string, ops?: IOpContextBase[]) {
    super();
    this.tableId = tableId;
    this.recordId = recordId;
    this.ops = ops;
  }
}

export class RecordUpdatedEvent extends RecordCreatedEvent {
  eventName: IEventName = EventEnums.RecordUpdated;
  ops!: IOpContextBase[];

  constructor(tableId: string, recordId: string, ops: IOpContextBase[]) {
    super(tableId, recordId, ops);
    this.ops = ops;
  }
}

export class RecordDeletedEvent extends RecordCreatedEvent {
  eventName: IEventName = EventEnums.RecordDeleted;

  constructor(tableId: string, recordId: string) {
    super(tableId, recordId);
  }
}
