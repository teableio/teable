import type { IViewRowCountVo } from '@teable-group/core';
import { getRowCountChannel } from '@teable-group/core/dist/models/channel';
import type { Presence } from '@teable/sharedb/lib/client';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';
import { View } from '../../model';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { RowCountContext } from './RowCountContext';

interface IRowCountProviderProps {
  children: ReactNode;
}

const previousSet = new Set();

export const RowCountProvider: FC<IRowCountProviderProps> = ({ children }) => {
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [rowCount, setRowCount] = useState<number>(0);

  useEffect(() => {
    if (!tableId || !viewId || !connection) {
      return;
    }

    const channel = getRowCountChannel(tableId, viewId);
    setRemotePresence(connection.getPresence(channel));

    if (!remotePresence?.subscribed) {
      remotePresence?.subscribe((err) => err && console.error);
      remotePresence?.on('receive', (id, res: IViewRowCountVo) => {
        setRowCount(res[viewId].rowCount ?? 0);
      });
    }

    return () => {
      remotePresence?.destroy();
    };
  }, [connection, remotePresence, tableId, viewId]);

  useEffect(() => {
    if (tableId == null || viewId == null) return;
    if (previousSet.has(`${tableId}-${viewId}`)) return;
    previousSet.add(`${tableId}-${viewId}`);

    View.getViewRowCount(tableId, viewId).then((res) => {
      previousSet.clear();
      setRowCount(res[viewId].rowCount ?? 0);
    });
  }, [tableId, viewId, connection]);

  return <RowCountContext.Provider value={rowCount}>{children}</RowCountContext.Provider>;
};
