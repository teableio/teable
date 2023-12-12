import type { IRawRowCountVo } from '@teable-group/core';
import { getRowCountChannel } from '@teable-group/core/src/models/channel';
import { useContext, useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';

let referenceCount = 0;

export const useConnectionRowCount = (onChange?: () => void) => {
  const { connection } = useContext(AppContext);
  const { tableId, viewId } = useContext(AnchorContext);
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
      onChange?.();
    };

    remotePresence?.on('receive', receiveHandler);

    return () => {
      remotePresence?.removeListener('receive', receiveHandler);
      canCreatePresence && referenceCount--;
      if (referenceCount === 0) {
        remotePresence?.unsubscribe();
        remotePresence?.destroy();
      }
      setRemotePresence(undefined);
    };
  }, [connection, onChange, remotePresence, tableId, viewId]);

  return rowCount;
};
