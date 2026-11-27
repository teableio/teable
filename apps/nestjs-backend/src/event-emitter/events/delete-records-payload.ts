import type { IRecord } from '@teable/core';
import type { IRecordRemovalReason } from '@teable/v2-core';

/** Payload of Events.OPERATION_RECORDS_DELETE, shared by undo, trash, and archive. */
export interface IDeleteRecordsPayload {
  operationId: string;
  windowId?: string;
  tableId: string;
  userId: string;
  records: (IRecord & { version?: number; order?: Record<string, number> })[];
  // 'archived' removals persist their own snapshot before deleting; trash sinks skip them.
  removalReason?: IRecordRemovalReason;
}
