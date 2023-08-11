import type { IOpContextBase } from '@teable-group/core/dist/op-builder/interface';
import type { EventEnums } from './event.enum';
import type { IEventBase } from './interfaces/event-base.interface';

type IEventName = Extract<EventEnums, EventEnums.FieldCreated | EventEnums.FieldUpdated>;

export class FieldEvent implements IEventBase {
  eventName!: IEventName;
  tableId!: string;
  fieldId!: string;
  snapshot!: unknown;
  ops!: IOpContextBase[];
}
