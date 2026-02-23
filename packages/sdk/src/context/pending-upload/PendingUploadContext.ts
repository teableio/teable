import { createContext, useContext } from 'react';

export interface IPendingUploadContext {
  /** Temporary record ID used as cellKey in the global upload store */
  tempRecordId: string;
  tableId: string;
}

export const PendingUploadContext = createContext<IPendingUploadContext | null>(null);

/**
 * Returns the pending upload context if inside a PendingUploadProvider.
 * Returns null when not in a pending upload context (normal cell/local mode).
 */
export const usePendingUploadContext = () => {
  return useContext(PendingUploadContext);
};
