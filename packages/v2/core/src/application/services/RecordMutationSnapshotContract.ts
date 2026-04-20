import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { RecordStoredSnapshot, RecordUpdateSnapshot } from '../../ports/TableRecordRepository';
import type { UndoRedoRestoreRecord } from '../../ports/UndoRedoStore';

type MutationSnapshotRequirement = {
  operation: 'create' | 'update' | 'delete' | 'duplicate';
  tableId: string;
  recordId?: string;
  expectedCount?: number;
  actualCount?: number;
};

const buildMissingSnapshotError = (
  params: MutationSnapshotRequirement,
  snapshotType: 'stored' | 'update'
): DomainError =>
  domainError.infrastructure({
    code: `record.${snapshotType}_snapshot.missing`,
    message: `Record repository returned incomplete ${snapshotType} snapshot data for ${params.operation}.`,
    details: {
      operation: params.operation,
      tableId: params.tableId,
      ...(params.recordId ? { recordId: params.recordId } : {}),
      ...(params.expectedCount !== undefined ? { expectedCount: params.expectedCount } : {}),
      ...(params.actualCount !== undefined ? { actualCount: params.actualCount } : {}),
      reason: 'incomplete',
    },
  });

const buildUnavailableSnapshotError = (
  params: MutationSnapshotRequirement,
  snapshotType: 'stored' | 'update'
): DomainError =>
  domainError.infrastructure({
    code: `record.${snapshotType}_snapshot.unavailable`,
    message: `Record repository did not provide the required ${snapshotType} snapshot for ${params.operation}.`,
    details: {
      operation: params.operation,
      tableId: params.tableId,
      ...(params.recordId ? { recordId: params.recordId } : {}),
      ...(params.expectedCount !== undefined ? { expectedCount: params.expectedCount } : {}),
      ...(params.actualCount !== undefined ? { actualCount: params.actualCount } : {}),
      reason: 'unavailable',
    },
  });

export const requireStoredRecordSnapshot = (
  params: MutationSnapshotRequirement,
  snapshot: RecordStoredSnapshot | undefined
): Result<RecordStoredSnapshot, DomainError> => {
  if (!snapshot) {
    return err(buildUnavailableSnapshotError(params, 'stored'));
  }

  return ok(snapshot);
};

export const hasStoredRecordSnapshot = (
  snapshot: RecordStoredSnapshot | undefined
): snapshot is RecordStoredSnapshot => snapshot != null;

export const requireStoredRecordSnapshots = (
  params: MutationSnapshotRequirement,
  snapshots: ReadonlyArray<RecordStoredSnapshot> | undefined
): Result<ReadonlyArray<RecordStoredSnapshot>, DomainError> => {
  // Callers must short-circuit zero-target mutations before reaching this
  // contract. At this point, `undefined` means the repository omitted the
  // capture result entirely, while `[]` means capture ran but produced no rows.
  if (snapshots == null) {
    return err(buildUnavailableSnapshotError({ ...params, actualCount: 0 }, 'stored'));
  }

  const requiredSnapshots = snapshots;
  const actualCount = requiredSnapshots.length;
  if (actualCount === 0) {
    return err(buildMissingSnapshotError({ ...params, actualCount }, 'stored'));
  }

  if (params.expectedCount !== undefined && actualCount !== params.expectedCount) {
    return err(buildMissingSnapshotError({ ...params, actualCount }, 'stored'));
  }

  return ok(requiredSnapshots);
};

export const hasExpectedStoredRecordSnapshots = (
  expectedCount: number,
  snapshots: ReadonlyArray<RecordStoredSnapshot> | undefined
): snapshots is ReadonlyArray<RecordStoredSnapshot> =>
  snapshots != null && snapshots.length === expectedCount;

export const requireRecordUpdateSnapshot = (
  params: MutationSnapshotRequirement,
  snapshot: RecordUpdateSnapshot | undefined
): Result<RecordUpdateSnapshot, DomainError> => {
  if (!snapshot) {
    return err(buildUnavailableSnapshotError(params, 'update'));
  }

  return ok(snapshot);
};

export const hasRecordUpdateSnapshot = (
  snapshot: RecordUpdateSnapshot | undefined
): snapshot is RecordUpdateSnapshot => snapshot != null;

export const toUndoRedoRestoreRecord = (snapshot: RecordStoredSnapshot): UndoRedoRestoreRecord => ({
  recordId: snapshot.recordId,
  fields: snapshot.fields,
  ...(snapshot.version !== undefined ? { version: snapshot.version } : {}),
  ...(snapshot.orders ? { orders: snapshot.orders } : {}),
  ...(snapshot.autoNumber !== undefined ? { autoNumber: snapshot.autoNumber } : {}),
  ...(snapshot.createdTime ? { createdTime: snapshot.createdTime } : {}),
  ...(snapshot.createdBy ? { createdBy: snapshot.createdBy } : {}),
  ...(snapshot.lastModifiedTime ? { lastModifiedTime: snapshot.lastModifiedTime } : {}),
  ...(snapshot.lastModifiedBy ? { lastModifiedBy: snapshot.lastModifiedBy } : {}),
});

export const toUndoRedoRestoreRecords = (
  snapshots: ReadonlyArray<RecordStoredSnapshot>
): ReadonlyArray<UndoRedoRestoreRecord> =>
  snapshots.map((snapshot) => toUndoRedoRestoreRecord(snapshot));
