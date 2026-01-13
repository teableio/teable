import { useMemo } from 'react';
import type { ITableRecordRealtimeDTO } from '@teable/v2-core';

import { useShareDbQuery } from '../lib/shareDb';

export type UseRecordsParams = {
  tableId?: string;
  enabled?: boolean;
};

export type UseRecordsState = {
  records: ReadonlyArray<ITableRecordRealtimeDTO>;
  recordIds: ReadonlyArray<string>;
  removedRecordIds: ReadonlyArray<string>;
  status: 'idle' | 'connecting' | 'ready' | 'error';
  error: string | null;
};

/**
 * Subscribe to all records in a table via ShareDB query.
 *
 * Example:
 * ```tsx
 * const { records, status, error } = useRecords({
 *   tableId: 'tbl123',
 * });
 *
 * // Also available: recordIds, removedRecordIds for tracking additions/deletions
 * ```
 */
export const useRecords = (params: UseRecordsParams): UseRecordsState => {
  const { tableId, enabled = true } = params;

  const collection = useMemo(() => (tableId ? `rec_${tableId}` : undefined), [tableId]);

  // Empty query = all documents in collection
  const query = useMemo(() => ({}), []);

  const { status, data, ids, removedIds, error } = useShareDbQuery<ITableRecordRealtimeDTO>({
    collection,
    query,
    enabled: enabled && !!tableId,
  });

  return {
    records: data,
    recordIds: ids,
    removedRecordIds: removedIds,
    status,
    error,
  };
};
