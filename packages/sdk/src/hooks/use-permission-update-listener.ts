import { getBasePermissionUpdateChannel } from '@teable/core';
import { useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/sharedb';
import { useConnection } from './use-connection';

export const usePermissionUpdateListener = (
  baseId: string | undefined,
  trigger: (operatorUserId?: string) => void
) => {
  const [remotePresence, setRemotePresence] = useState<Presence>();
  const { connection } = useConnection();

  useEffect(() => {
    if (baseId == null || connection == null) return;
    const channel = getBasePermissionUpdateChannel(baseId);
    setRemotePresence(connection.getPresence(channel));

    remotePresence?.subscribe((err) => err && console.error);

    const receiveHandler = (_id: string, data: string) => {
      // The data contains the operator user ID
      trigger(data);
    };

    remotePresence?.on('receive', receiveHandler);

    return () => {
      remotePresence?.removeListener('receive', receiveHandler);
      remotePresence?.listenerCount('receive') === 0 && remotePresence?.unsubscribe();
      remotePresence?.listenerCount('receive') === 0 && remotePresence?.destroy();
    };
  }, [baseId, connection, remotePresence, trigger]);
};
