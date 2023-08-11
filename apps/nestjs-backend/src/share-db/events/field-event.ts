import type { IOpContextBase } from '@teable-group/core';
import { EventAbstract } from './abstract/event.abstract';
import { EventEnums } from './event.enum';

type IEventName = Extract<EventEnums, EventEnums.FieldCreated | EventEnums.FieldUpdated>;

export class FieldCreatedEvent extends EventAbstract {
  eventName: EventEnums = EventEnums.FieldCreated;
  tableId!: string;
  fieldId!: string;
  snapshot!: unknown;

  constructor(tableId: string, fieldId: string, snapshot: unknown) {
    super();
    this.tableId = tableId;
    this.fieldId = fieldId;
    this.snapshot = snapshot;
  }
}

export class FieldUpdatedEvent extends FieldCreatedEvent {
  eventName: IEventName = EventEnums.FieldUpdated;
  ops!: IOpContextBase[];

  constructor(tableId: string, fieldId: string, snapshot: unknown, ops: IOpContextBase[]) {
    super(tableId, fieldId, snapshot);
    this.ops = ops;
  }
}
