import type { IOpContextBase } from '@teable-group/core/dist/op-builder/interface';
import type { EventEnums } from './event.enum';
import type { IEventBase } from './interfaces/event-base.interface';

type IEventName = Extract<EventEnums, EventEnums.ViewCreated | EventEnums.ViewUpdated>;

export class ViewEvent implements IEventBase {
  eventName!: IEventName;
  tableId!: string;
  viewId!: string;
  snapshot!: unknown;
  ops!: IOpContextBase[];
}
