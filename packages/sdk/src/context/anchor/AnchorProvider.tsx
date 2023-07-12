import React, { useMemo } from 'react';
import { FieldProvider } from '../field';
import { RecordProvider } from '../record';
import { AnchorContext } from './AnchorContext';

export interface IAnchorProvider {
  tableId?: string;
  viewId?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const AnchorProvider: React.FC<IAnchorProvider> = ({
  children,
  viewId,
  tableId,
  fallback,
}) => {
  const value = useMemo(() => {
    return { viewId, tableId };
  }, [viewId, tableId]);

  return (
    <AnchorContext.Provider value={value}>
      <FieldProvider fallback={fallback}>
        <RecordProvider>{children}</RecordProvider>
      </FieldProvider>
    </AnchorContext.Provider>
  );
};
