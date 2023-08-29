import React, { useMemo } from 'react';
import { FieldContext, FieldProvider } from '../field';
import { RecordContext, RecordProvider } from '../record';
import { ViewContext, ViewProvider } from '../view';
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
      {tableId ? (
        <FieldProvider fallback={fallback}>
          <ViewProvider>
            <RecordProvider>{children}</RecordProvider>
          </ViewProvider>
        </FieldProvider>
      ) : (
        <FieldContext.Provider value={{ fields: [] }}>
          <ViewContext.Provider value={{ views: [] }}>
            <RecordContext.Provider value={{}}>{children}</RecordContext.Provider>
          </ViewContext.Provider>
        </FieldContext.Provider>
      )}
    </AnchorContext.Provider>
  );
};
