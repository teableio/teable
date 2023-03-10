import { ITableSnapshot, ITableVo, IdPrefix } from '@teable-group/core';
import { AppContext } from '../../context/app';
import { Table, createTableInstance } from '../../model';
import { FC, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { TableContext } from './TableContext';
import { Doc } from 'sharedb/lib/client';

interface ITableProviderProps {
  tableId?: string;
  viewId?: string;
  serverData?: ITableVo[];
  children: ReactNode;
}

export const TableProvider: FC<ITableProviderProps> = ({
  tableId,
  viewId,
  children,
  serverData,
}) => {
  const { connection } = useContext(AppContext);
  const [tables, setTables] = useState<Table[]>(() => {
    if (serverData) {
      return serverData.map((table) => createTableInstance(table));
    }
    return [];
  });

  const updateTable = useCallback(
    (doc: Doc<ITableSnapshot>) => {
      const newTable = createTableInstance(doc.data.table, doc, connection);
      setTables(
        tables.map((table) => {
          if (table.id === newTable.id) {
            return newTable;
          }
          return table;
        })
      );
    },
    [tables]
  );

  useEffect(() => {
    if (!connection) {
      return;
    }

    const query = connection.createSubscribeQuery<ITableSnapshot>('node', {
      type: IdPrefix.Table,
    });

    query.on('ready', () => {
      console.log('table:ready:', query.results);
      setTables(query.results.map((r) => createTableInstance(r.data.table, r, connection)));
      query.results.forEach((doc) => {
        doc.on('op', (op) => {
          console.log('doc on op:', op);
          updateTable(doc);
        });
      });
    });

    query.on('changed', () => {
      console.log('table:changed:', query.results);
      setTables(query.results.map((r) => createTableInstance(r.data.table, r, connection)));
    });

    query.on('insert', (docs) => {
      docs.forEach((doc) => {
        doc.on('op', (op) => {
          console.log('doc on op:', op);
          updateTable(doc);
        });
      });
    });

    query.on('remove', (docs) => {
      docs.forEach((doc) => {
        doc.removeAllListeners('op');
      });
    });

    return () => {
      query.destroy();
    };
  }, [connection, tableId]);

  const value = useMemo(() => {
    return { tableId, viewId, tables };
  }, [tableId, viewId, tables]);

  return <TableContext.Provider value={value}>{children}</TableContext.Provider>;
};
