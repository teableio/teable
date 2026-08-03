import { getCommentChannel } from '@teable/core';
import { isEmpty, get } from 'lodash';
import { useEffect } from 'react';
import { useConnection } from '../../../hooks';

export const useCommentPatchListener = (
  tableId: string,
  recordId: string,
  cb: (remoteData: unknown) => void
) => {
  const { connection } = useConnection();
  const presenceKey = getCommentChannel(tableId, recordId);
  const presence = connection?.getPresence(presenceKey);

  useEffect(() => {
    if (!presence || !tableId || !connection || !recordId) {
      return;
    }

    if (presence.subscribed) {
      return;
    }

    presence.subscribe();

    const receiveHandler = () => {
      const { remotePresences } = presence;
      !isEmpty(remotePresences) && cb?.(get(remotePresences, presenceKey));
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence?.removeListener('receive', receiveHandler);
      presence?.listenerCount('receive') === 0 && presence?.unsubscribe();
      presence?.listenerCount('receive') === 0 && presence?.destroy();
    };
  }, [cb, connection, presence, presenceKey, recordId, tableId]);
};
