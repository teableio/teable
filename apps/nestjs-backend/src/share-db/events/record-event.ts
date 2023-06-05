import type ShareDBClass from '@teable/sharedb';
import type { EventEnums } from './event.enum';

type IEventName = Extract<EventEnums, EventEnums.RecordCreated | EventEnums.RecordUpdated>;

export class RecordEvent {
  eventName!: IEventName;
  tableId!: string;
  recordId!: string;
  context!: ShareDBClass.middleware.SubmitContext;
}
