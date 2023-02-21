import { AppContext } from '@/context/app/AppContext';
import { AggregateKey, IAggregateQuery, SnapshotQueryType } from '@teable-group/core';
import { ReactNode, useContext, useEffect, useState } from 'react';
import { FieldContext } from '../field/FieldContext';
import { TableContext } from '../table/TableContext';
import { RecordContext } from './RecordContext';

export interface IRecordProviderContext {
  viewId?: string;
  children: ReactNode;
}

export const RecordProvider: React.FC<IRecordProviderContext> = ({ viewId, children }) => {
  const [rowCount, setRowCount] = useState(0);
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

  return <RecordContext.Provider value={{ rowCount }}>{children}</RecordContext.Provider>;
};
