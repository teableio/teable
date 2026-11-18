import { useEffect, useState } from 'react';

type IRaiseListener = (tableId: string, recordId: string) => void;

const listeners = new Set<IRaiseListener>();

/**
 * Tells an open record panel that its record was just expanded again: a panel covered by another
 * one opened beside it later (a new-record draft) comes back on top. Call it from every place
 * that expands a record, also when that record is already the open one, since then nothing else
 * changes for the panel to notice.
 */
export const raiseRecordPanel = (tableId: string, recordId: string) => {
  listeners.forEach((listener) => listener(tableId, recordId));
};

/** How many times this record has been raised while it was open. */
export const useRecordPanelRaiseCount = (tableId?: string, recordId?: string) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!tableId || !recordId) return;
    const listener: IRaiseListener = (raisedTableId, raisedRecordId) => {
      if (raisedTableId === tableId && raisedRecordId === recordId) {
        setCount((value) => value + 1);
      }
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [tableId, recordId]);

  return count;
};
