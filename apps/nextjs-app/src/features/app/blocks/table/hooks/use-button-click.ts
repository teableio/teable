import { getTableButtonClickChannel } from '@teable/core';
import { useConnection } from '@teable/sdk/hooks';
import { isEmpty, get } from 'lodash';
import { useEffect, useState } from 'react';

export const useButtonClick = (tableId: string, recordId: string, fieldId: string) => {
  const { connection } = useConnection();
  const channel = getTableButtonClickChannel(tableId, recordId, fieldId);
  const presence = connection?.getPresence(channel);
  const [loading, setLoading] = useState(false);
  console.log('fixme uno useButtonClick tableId', tableId, recordId, fieldId, loading);
  useEffect(() => {
    if (!presence || !channel) {
      return;
    }

    if (presence.subscribed) {
      return;
    }

    presence.subscribe();

    const receiveHandler = () => {
      const { remotePresences } = presence;
      if (!isEmpty(remotePresences)) {
        const remoteStatus = get(remotePresences, channel);
        setLoading(remoteStatus ?? false);
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence.unsubscribe();
      presence?.removeListener('receive', receiveHandler);
    };
  }, [connection, presence, channel]);

  return { loading };
};
