import type ShareDBClass from '@teable/sharedb';

export class RecordCreatedEvent {
  public static EVENT_NAME = 'RECORD_CREATED';
  tableId!: string;
  recordId!: string;
  context!: ShareDBClass.middleware.SubmitContext;
}
