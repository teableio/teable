/**
 * What an edition does once trashed records are back in their table. The records restore without
 * domain events, so nothing else tells it. The community edition does nothing; the enterprise
 * trash module provides it to the TrashService it builds (optional dependency).
 */
export interface IRecordsRestoreHook {
  /** Runs once the restore has committed and the trash entry is gone. */
  afterRestore(restore: { tableId: string; recordIds: string[] }): Promise<void>;
}

export const RECORDS_RESTORE_HOOK = 'RECORDS_RESTORE_HOOK';
