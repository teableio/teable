import type { IRecord } from '@teable-group/core';
import type { ReactNode } from 'react';
import { useContext, useMemo } from 'react';
import { AppContext } from '../app/AppContext';
import { RecordContext } from './RecordContext';

export interface IRecordProviderContext {
  children: ReactNode;
  serverRecords?: IRecord[];
  serverRecord?: IRecord;
}

export const RecordProvider: React.FC<IRecordProviderContext> = ({
  children,
  serverRecords,
  serverRecord,
}) => {
  const { connected } = useContext(AppContext);

  const value = useMemo(() => {
    return connected
      ? { serverRecords: undefined, serverRecord: undefined }
      : { serverRecords, serverRecord };
  }, [connected, serverRecords, serverRecord]);

  return <RecordContext.Provider value={value}>{children}</RecordContext.Provider>;
};
