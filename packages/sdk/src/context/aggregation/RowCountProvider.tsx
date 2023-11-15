import type { IRawRowCountVo } from '@teable-group/core';
import { getRowCountChannel } from '@teable-group/core/dist/models/channel';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';
import { useBase, useIsHydrated } from '../../hooks';
import { Table, View } from '../../model';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { RowCountContext } from './RowCountContext';

interface IRowCountProviderProps {
  children: ReactNode;
}
let referenceCount = 0;

export const RowCountProvider: FC<IRowCountProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const base = useBase();
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [rowCount, setRowCount] = useState<number | null>(null);

  useEffect(() => {
    const canCreatePresence = tableId && viewId && connection;
    if (!canCreatePresence) {
      return;
    }

    referenceCount++;
    const channel = getRowCountChannel(tableId, viewId);
    setRemotePresence(connection.getPresence(channel));

    remotePresence?.subscribe((err) => err && console.error);

    const receiveHandler = (_id: string, res: IRawRowCountVo) => {
      setRowCount(res[viewId].rowCount ?? 0);
    };

    remotePresence?.on('receive', receiveHandler);

    return () => {
      remotePresence?.removeListener('receive', receiveHandler);
      canCreatePresence && referenceCount--;
      if (referenceCount === 0) {
        remotePresence?.unsubscribe();
        remotePresence?.destroy();
      }
    };
  }, [connection, remotePresence, tableId, viewId]);

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
