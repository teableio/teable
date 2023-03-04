import { AppContext } from '../app/AppContext';
import { AggregateKey, IAggregateQuery, IRecord, SnapshotQueryType } from '@teable-group/core';
import { ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { TableContext } from '../table/TableContext';
import { RecordContext } from './RecordContext';

export interface IRecordProviderContext {
  viewId?: string;
  children: ReactNode;
  serverData?: { records: IRecord[]; total: number };
}

export const RecordProvider: React.FC<IRecordProviderContext> = ({
  viewId,
  children,
  serverData,
}) => {
  const [rowCount, setRowCount] = useState(serverData?.total ?? 0);
  const { connection } = useContext(AppContext);
  const { tableId } = useContext(TableContext);

  useEffect(() => {
    const param: IAggregateQuery = {
      viewId,
      type: SnapshotQueryType.Aggregate,
      aggregateKey: AggregateKey.RowCount,
    };

    const query = connection.createSubscribeQuery<number>(tableId, param);

    query.on('ready', () => {
      console.log('rowCount:ready:', query);
      const count = query.results[0].data;
      setRowCount(count);
    });

    query.on('changed', () => {
      const count = query.results[0].data;
      console.log('rowCount:changed:', count);
      setRowCount(count);
    });

    return () => {
      query.destroy();
    };
  }, [tableId, connection]);

  const value = useMemo(() => {
    return { rowCount, serverRecords: serverData?.records };
  }, [rowCount, serverData]);

  return <RecordContext.Provider value={value}>{children}</RecordContext.Provider>;
};
