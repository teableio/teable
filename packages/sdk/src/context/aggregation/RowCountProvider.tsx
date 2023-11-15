import { type IRawRowCountVo } from '@teable-group/core';
import { getRowCountChannel } from '@teable-group/core/dist/models/channel';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { RowCountContext } from './RowCountContext';

interface IRowCountProviderProps {
  rowCountWithoutConnected?: number;
  children: ReactNode;
}
let referenceCount = 0;

export const RowCountProvider: FC<IRowCountProviderProps> = ({
  children,
  rowCountWithoutConnected,
}) => {
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [rowCount, setRowCount] = useState<number>();

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

  return (
    <RowCountContext.Provider value={rowCount ?? rowCountWithoutConnected ?? null}>
      {children}
    </RowCountContext.Provider>
  );
};
