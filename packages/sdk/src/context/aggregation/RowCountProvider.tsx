import type { IRawRowCountVo } from '@teable-group/core';
import { getRowCountChannel } from '@teable-group/core/dist/models/channel';
import type { Presence } from '@teable/sharedb/lib/client';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';
import { useIsHydrated } from '../../hooks';
import { View } from '../../model';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { RowCountContext } from './RowCountContext';

interface IRowCountProviderProps {
  children: ReactNode;
}

export const RowCountProvider: FC<IRowCountProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [rowCount, setRowCount] = useState<number | null>(null);

  useEffect(() => {
    if (!tableId || !viewId || !connection) {
      return;
    }

    const channel = getRowCountChannel(tableId, viewId);
    setRemotePresence(connection.getPresence(channel));

    if (!remotePresence?.subscribed) {
      remotePresence?.subscribe((err) => err && console.error);
      remotePresence?.on('receive', (id, res: IRawRowCountVo) => {
        setRowCount(res[viewId].rowCount ?? 0);
      });
    }

    return () => {
      remotePresence?.destroy();
    };
  }, [connection, remotePresence, tableId, viewId]);

  useEffect(() => {
    if (tableId == null || viewId == null || !isHydrated) return;

    View.getViewRowCount(tableId, viewId).then((res) => {
      setRowCount(res.rowCount);
    });
  }, [tableId, viewId, connection, isHydrated]);

  return <RowCountContext.Provider value={rowCount}>{children}</RowCountContext.Provider>;
};
