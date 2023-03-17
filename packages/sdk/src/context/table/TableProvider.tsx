import type { ITableSnapshot, ITableVo } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppContext } from '../../context/app';
import type { Table } from '../../model';
import { createTableInstance } from '../../model';
import { TableContext } from './TableContext';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connection]
  );

  useEffect(() => {
    if (!connection) {
      return;
    }

    const query = connection.createSubscribeQuery<ITableSnapshot>(`${IdPrefix.Table}_node`, {});

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
  }, [connection, tableId, updateTable]);

  const value = useMemo(() => {
    return { tableId, viewId, tables };
  }, [tableId, viewId, tables]);

  return <TableContext.Provider value={value}>{children}</TableContext.Provider>;
};
