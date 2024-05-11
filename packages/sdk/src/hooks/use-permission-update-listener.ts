import { getBasePermissionUpdateChannel } from '@teable/core';
import { useContext, useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/sharedb';
import { AppContext } from '../context';

export const usePermissionUpdateListener = (baseId: string | undefined, trigger: () => void) => {
  const [remotePresence, setRemotePresence] = useState<Presence>();
  const { connection } = useContext(AppContext);

  useEffect(() => {
    if (baseId == null || connection == null) return;
    const channel = getBasePermissionUpdateChannel(baseId);
    setRemotePresence(connection.getPresence(channel));

    remotePresence?.subscribe((err) => err && console.error);

    const receiveHandler = (_id: string) => {
      trigger();
    };

    remotePresence?.on('receive', receiveHandler);

    return () => {
      remotePresence?.removeListener('receive', receiveHandler);
      remotePresence?.unsubscribe();
      remotePresence?.destroy();
    };
  }, [baseId, connection, remotePresence, trigger]);
};
