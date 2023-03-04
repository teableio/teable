import { IFieldVo, ITableSnapshot, ITableVo, SnapshotQueryType } from '@teable-group/core';
import { AppContext } from '../../context/app';
import { Table, createTableInstance } from '../../model';
import { FC, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { TableContext } from './TableContext';

interface ITableProviderProps {
  tableId?: string;
  viewId?: string;
  serverData?: ITableVo[];
  children: ReactNode;
}

export const TableProvider: FC<ITableProviderProps> = ({ tableId, children, serverData }) => {
  const { connection } = useContext(AppContext);
  const [tables, setTables] = useState<Table[]>(() => {
    if (serverData) {
      return serverData.map((table) => createTableInstance(table));
    }
    return [];
  });

  useEffect(() => {
    if (!tableId) {
      return;
    }
    const tablesQuery = connection.createSubscribeQuery<ITableSnapshot>(tableId, {
      type: SnapshotQueryType.Table,
    });

    tablesQuery.on('ready', () => {
      console.log('table:ready:', tablesQuery.results);
      setTables(tablesQuery.results.map((r) => createTableInstance(r.data.table, r)));
    });

    tablesQuery.on('changed', () => {
      console.log('table:changed:', tablesQuery.results);
      setTables(tablesQuery.results.map((r) => createTableInstance(r.data.table, r)));
    });

    return () => {
      tablesQuery.destroy();
    };
  }, [connection, tableId]);

  const value = useMemo(() => {
    return { tableId, tables };
  }, [tableId, tables]);

  return <TableContext.Provider value={value}>{children}</TableContext.Provider>;
};
