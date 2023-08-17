import type { IRecord, IRecordSnapshotQuery } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import type { ReactNode } from 'react';
import { useContext, useEffect, useMemo, useState } from 'react';
import { AnchorContext } from '../anchor/AnchorContext';
import { AppContext } from '../app/AppContext';
import { RecordContext } from './RecordContext';

export interface IRecordProviderContext {
  children: ReactNode;
  serverData?: { records: IRecord[]; total: number };
}

export const RecordProvider: React.FC<IRecordProviderContext> = ({ children, serverData }) => {
  const [rowCount, setRowCount] = useState(serverData?.total ?? 0);
  const { connection, connected } = useContext(AppContext);
  const { tableId, viewId } = useContext(AnchorContext);

  useEffect(() => {
    const param: IRecordSnapshotQuery = {
      viewId,
      type: IdPrefix.Record,
      orderBy: [
        {
          column: '__created_time',
          order: 'desc',
        },
      ],
      aggregate: {
        rowCount: true,
      },
      offset: 0,
      limit: 1,
    };

    if (!tableId || !connection) {
      return;
    }

    const query = connection.createSubscribeQuery<IRecord>(`${IdPrefix.Record}_${tableId}`, param);

    query.on('ready', () => {
      const count = query.extra?.rowCount ?? 0;
      console.log('rowCount:ready:', count);
      setRowCount(count);
    });

    query.on('extra', (extra) => {
      const count = extra?.rowCount ?? 0;
      console.log('rowCount:changed:', count);
      setRowCount(count);
    });

    return () => {
      setRowCount(0);
      query.destroy();
    };
  }, [tableId, connection, viewId]);

  const value = useMemo(() => {
    return { rowCount, serverRecords: connected ? undefined : serverData?.records };
  }, [rowCount, serverData, connected]);

  return <RecordContext.Provider value={value}>{children}</RecordContext.Provider>;
};
