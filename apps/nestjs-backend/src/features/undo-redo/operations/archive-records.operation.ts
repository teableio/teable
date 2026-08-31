import type { IArchiveRecordsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';

// Record archive is an enterprise-only feature: the orchestrator (ArchiveService) lives in
// the enterprise edition and is injected into the community undo stack through this token
// (@Global provider on the EE side, @Optional() here). In a pure community boot the token
// resolves to undefined — archive endpoints do not exist there, so archive operations can
// only reach the stack on an enterprise deployment.
export const ARCHIVE_UNDO_SERVICE = 'ARCHIVE_UNDO_SERVICE';

export interface IArchiveUndoService {
  archiveRecords(
    tableId: string,
    recordIds: string[],
    windowId?: string
  ): Promise<{ archivedRecordIds: string[]; operationId: string }>;
  restoreArchiveRecordsByOperationId(
    tableId: string,
    operationId: string
  ): Promise<{ restoredRecordIds: string[] }>;
}

export interface IArchiveRecordsPayload {
  operationId: string;
  windowId?: string;
  tableId: string;
  userId: string;
  recordIds: string[];
}

export class ArchiveRecordsOperation {
  constructor(private readonly archiveService?: IArchiveUndoService) {}

  private requireService(): IArchiveUndoService {
    if (!this.archiveService) {
      throw new Error('Record archive requires the enterprise edition');
    }
    return this.archiveService;
  }

  async event2Operation(payload: IArchiveRecordsPayload): Promise<IArchiveRecordsOperation> {
    return {
      name: OperationName.ArchiveRecords,
      params: {
        tableId: payload.tableId,
      },
      result: {
        recordIds: payload.recordIds,
      },
      operationId: payload.operationId,
    };
  }

  // Restores exactly the rows this operation archived (matched by operationId); a no-op
  // if they were purged from the archive meanwhile.
  async undo(operation: IArchiveRecordsOperation) {
    const { params, operationId } = operation;
    await this.requireService().restoreArchiveRecordsByOperationId(params.tableId, operationId);
    return operation;
  }

  async redo(operation: IArchiveRecordsOperation) {
    const { params, result } = operation;
    const { archivedRecordIds, operationId } = await this.requireService().archiveRecords(
      params.tableId,
      result.recordIds
    );
    // Re-archiving persists new snapshot rows under a new operationId — refresh the
    // entry so a following undo matches them.
    return { ...operation, operationId, result: { recordIds: archivedRecordIds } };
  }
}
