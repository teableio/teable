import type { IOpContextBase } from '@teable-group/core';
import { EventAbstract } from '../abstract/event.abstract';
import { EventEnums } from './event.enum';

type IEventName = Extract<EventEnums, EventEnums.FieldCreated | EventEnums.FieldUpdated>;

export class FieldCreatedEvent extends EventAbstract {
  eventName: EventEnums = EventEnums.FieldCreated;
  tableId!: string;
  fieldId!: string;
  ops?: IOpContextBase[];

  constructor(tableId: string, fieldId: string, ops: IOpContextBase[]) {
    super();
    this.tableId = tableId;
    this.fieldId = fieldId;
    this.ops = ops;
  }
}

export class FieldUpdatedEvent extends FieldCreatedEvent {
  eventName: IEventName = EventEnums.FieldUpdated;
  ops!: IOpContextBase[];

  constructor(tableId: string, fieldId: string, ops: IOpContextBase[]) {
    super(tableId, fieldId, ops);
    this.ops = ops;
  }
}
