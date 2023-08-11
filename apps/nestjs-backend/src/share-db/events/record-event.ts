import type { IOpContextBase } from '@teable-group/core/dist/op-builder/interface';
import type { EventEnums } from './event.enum';
import type { IEventBase } from './interfaces/event-base.interface';

type IEventName = Extract<EventEnums, EventEnums.RecordCreated | EventEnums.RecordUpdated>;

export class RecordEvent implements IEventBase {
  eventName!: IEventName;
  tableId!: string;
  recordId!: string;
  snapshot!: unknown;
  ops!: IOpContextBase[];
}
