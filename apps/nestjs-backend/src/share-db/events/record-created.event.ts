import type ShareDBClass from '@teable/sharedb';
import { EventEnums } from './event.enum';

export class RecordCreatedEvent {
  public static EVENT_NAME: string = EventEnums.RecordCreated;
  tableId!: string;
  recordId!: string;
  context!: ShareDBClass.middleware.SubmitContext;
}
