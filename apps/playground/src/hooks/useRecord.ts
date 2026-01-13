import { useMemo } from 'react';
import type { ITableRecordRealtimeDTO } from '@teable/v2-core';

import { useShareDbDoc } from '../lib/shareDb';

export type UseRecordParams = {
  tableId?: string;
  recordId?: string;
  enabled?: boolean;
};

export type UseRecordState = {
  record: ITableRecordRealtimeDTO | null;
  status: 'idle' | 'connecting' | 'ready' | 'error';
  error: string | null;
};

/**
 * Subscribe to a single record via ShareDB.
 *
 * Example:
 * ```tsx
 * const { record, status, error } = useRecord({
 *   tableId: 'tbl123',
 *   recordId: 'rec456',
 * });
 * ```
 */
export const useRecord = (params: UseRecordParams): UseRecordState => {
  const { tableId, recordId, enabled = true } = params;

  const collection = useMemo(() => (tableId ? `rec_${tableId}` : undefined), [tableId]);

  const { status, data, error } = useShareDbDoc<ITableRecordRealtimeDTO>({
    collection,
    docId: recordId,
    enabled: enabled && !!tableId && !!recordId,
  });

  return { record: data, status, error };
};
