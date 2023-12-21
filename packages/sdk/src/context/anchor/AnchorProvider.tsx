import React, { useMemo } from 'react';
import { ActionTriggerProvider } from '../action-trigger';
import { RowCountContext, RowCountProvider } from '../aggregation';
import { FieldContext, FieldProvider } from '../field';
import { RecordContext, RecordProvider } from '../record';
import { ViewContext, ViewProvider } from '../view';
import { AnchorContext } from './AnchorContext';

export interface IAnchorProvider {
  baseId?: string;
  tableId?: string;
  viewId?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const AnchorProvider: React.FC<IAnchorProvider> = ({
  children,
  viewId,
  tableId,
  baseId,
  fallback,
}) => {
  const value = useMemo(() => {
    return { viewId, tableId, baseId };
  }, [viewId, tableId, baseId]);

  return (
    <AnchorContext.Provider value={value}>
      {tableId ? (
        <ActionTriggerProvider>
          <FieldProvider fallback={fallback}>
            <ViewProvider>
              <RecordProvider>
                <RowCountProvider>{children}</RowCountProvider>
              </RecordProvider>
            </ViewProvider>
          </FieldProvider>
        </ActionTriggerProvider>
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
