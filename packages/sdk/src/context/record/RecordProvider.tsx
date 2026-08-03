import type { IRecord } from '@teable/core';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
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
  const value = useMemo(() => {
    return { serverRecords, serverRecord };
  }, [serverRecords, serverRecord]);

  return <RecordContext.Provider value={value}>{children}</RecordContext.Provider>;
};
