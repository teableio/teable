import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';
import { useBase, useIsHydrated } from '../../hooks';
import { Table, View } from '../../model';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { RowCountContext } from './RowCountContext';
import { useConnectionRowCount } from './useConnectionRowCount';

interface IRowCountProviderProps {
  children: ReactNode;
}

export const RowCountProvider: FC<IRowCountProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const base = useBase();
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [rowCount, setRowCount] = useState<number | null>(null);
  const connectionRowCount = useConnectionRowCount();

  useEffect(() => setRowCount(connectionRowCount), [connectionRowCount]);

  useEffect(() => {
    if (tableId == null || !isHydrated) return;

    if (viewId == null) {
      Table.getRowCount(base.id, tableId).then((res) => {
        setRowCount(res.data.rowCount);
      });
      return;
    }

    View.getViewRowCount(tableId, viewId).then((res) => {
      setRowCount(res.data.rowCount);
    });
  }, [tableId, viewId, connection, isHydrated, base.id]);

  return <RowCountContext.Provider value={rowCount}>{children}</RowCountContext.Provider>;
};
