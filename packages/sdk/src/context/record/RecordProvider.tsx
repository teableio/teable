import type { IRecord } from '@teable-group/core';
import type { ReactNode } from 'react';
import { useContext, useMemo } from 'react';
import { AppContext } from '../app/AppContext';
import { RecordContext } from './RecordContext';

export interface IRecordProviderContext {
  children: ReactNode;
  serverData?: { records: IRecord[] };
}

export const RecordProvider: React.FC<IRecordProviderContext> = ({ children, serverData }) => {
  const { connected } = useContext(AppContext);

  const value = useMemo(() => {
    return { serverRecords: connected ? undefined : serverData?.records };
  }, [serverData, connected]);

  return <RecordContext.Provider value={value}>{children}</RecordContext.Provider>;
};
