import React, { useMemo } from 'react';
import { RowCountContext } from '../aggregation/RowCountContext';
import { RowCountProvider } from '../aggregation/RowCountProvider';
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
            <RecordProvider>
              <RowCountProvider>{children}</RowCountProvider>
            </RecordProvider>
          </ViewProvider>
        </FieldProvider>
      ) : (
        <FieldContext.Provider value={{ fields: [] }}>
          <ViewContext.Provider value={{ views: [] }}>
            <RecordContext.Provider value={{}}>
              <RowCountContext.Provider value={null}>{children}</RowCountContext.Provider>
            </RecordContext.Provider>
          </ViewContext.Provider>
        </FieldContext.Provider>
      )}
    </AnchorContext.Provider>
  );
};
