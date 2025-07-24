import { getTableButtonClickChannel } from '@teable/core';
import { sonner } from '@teable/ui-lib';
import { isEmpty, get } from 'lodash';
import { useEffect, useState } from 'react';
// import { useTranslation } from '../context/app/i18n';
import { useConnection } from './use-connection';

export interface IButtonClickStatus {
  loading: boolean;
  message: string;
}
const { toast } = sonner;

export const useButtonClickStatus = (tableId: string) => {
  const { connection } = useConnection();
  const channel = getTableButtonClickChannel(tableId);
  const presence = connection?.getPresence(channel);
  const [status, setStatus] = useState<IButtonClickStatus>({
    loading: false,
    message: '',
  });
  // console.log('fixme uno useButtonClickStatus tableId', tableId, JSON.stringify(status));
  // const { t } = useTranslation();
  // const { loading, message } = status;
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
        setStatus(remoteStatus ?? {});
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence.unsubscribe();
      presence?.removeListener('receive', receiveHandler);
    };
  }, [connection, presence, channel, tableId]);

  useEffect(() => {
    if (status.message) {
      toast(status.message);
    }
  }, [status]);

  return { status };
};
