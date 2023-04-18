import type ShareDBClass from '@teable/sharedb';

export class RecordUpdatedEvent {
  public static EVENT_NAME = 'RECORD_UPDATED';
  tableId!: string;
  recordId!: string;
  context!: ShareDBClass.middleware.SubmitContext;
}
