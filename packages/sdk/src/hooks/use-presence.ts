import { getActionTriggerChannel } from '@teable/core';
import { useContext, useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/sharedb';
import { AppContext } from '../context/app/AppContext';

export const useActionPresence = (tableIdOrViewId: string | undefined) => {
  const { connection } = useContext(AppContext);
  const [presence, setPresence] = useState<Presence>();

  useEffect(() => {
    if (connection == null || tableIdOrViewId == null) return;

    const remotePresence = connection.getPresence(getActionTriggerChannel(tableIdOrViewId));

    if (!remotePresence.subscribed) {
      remotePresence.subscribe((err) => {
        err && console.error(err);
      });
    }

    setPresence(remotePresence);
  }, [tableIdOrViewId, connection]);

  return presence;
};
