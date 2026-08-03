import { getTableImportChannel } from '@teable/core';
import { useConnection } from '@teable/sdk/hooks';
import { isEmpty, get } from 'lodash';
import { useEffect, useState } from 'react';

export const useImportStatus = (tableId: string) => {
  const { connection } = useConnection();
  const presence = connection?.getPresence(getTableImportChannel(tableId));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!presence || !tableId) {
      return;
    }

    if (presence.subscribed) {
      return;
    }

    presence.subscribe();

    const receiveHandler = () => {
      const { remotePresences } = presence;
      if (!isEmpty(remotePresences)) {
        const remoteStatus = get(remotePresences, [getTableImportChannel(tableId), 'loading']);
        setLoading(remoteStatus === undefined ? false : remoteStatus);
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence.unsubscribe();
      presence?.removeListener('receive', receiveHandler);
    };
  }, [connection, presence, tableId]);

  return { loading };
};
