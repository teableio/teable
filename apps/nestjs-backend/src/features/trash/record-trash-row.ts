import { generateRecordTrashId } from '@teable/core';
import type { IRecord } from '@teable/core';
import type { IRecordRemovalReason } from '@teable/v2-core';

type ISnapshotRecord = IRecord & { version?: number; order?: Record<string, number> };

// Projects record snapshots into record_trash rows: the JSON snapshot plus the extracted
// metadata columns the trash/archive UIs filter and sort by. Omitting `reason` leaves the
// column to its DB default ('deleted').
export const buildRecordTrashRows = (
  records: ISnapshotRecord[],
  options: {
    tableId: string;
    userId: string;
    createdTime: Date;
    operationId?: string;
    reason?: IRecordRemovalReason;
  }
) => {
  const { tableId, userId, createdTime, operationId, reason } = options;
  return records.map((record) => ({
    id: generateRecordTrashId(),
    tableId,
    recordId: record.id,
    snapshot: JSON.stringify(record),
    createdBy: userId,
    createdTime,
    operationId,
    reason,
    recordCreatedTime: record.createdTime ? new Date(record.createdTime) : undefined,
    recordCreatedBy: record.createdBy,
    recordLastModifiedTime: record.lastModifiedTime ? new Date(record.lastModifiedTime) : undefined,
    recordLastModifiedBy: record.lastModifiedBy,
  }));
};
