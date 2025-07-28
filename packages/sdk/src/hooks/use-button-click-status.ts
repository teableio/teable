import { getTableButtonClickChannel } from '@teable/core';
import { sonner } from '@teable/ui-lib';
import { isEmpty, get } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../context/app/i18n';
import { useConnection } from './use-connection';
import { useSession } from './use-session';

// userId-tableId-recordId-fieldId -> status
type IButtonClickStatus = Record<
  string,
  {
    loading: boolean;
    name: string;
    message?: string;
    errorMessage?: string;
  }
>;
const { toast } = sonner;

export const useButtonClickStatus = (tableId: string) => {
  const { user } = useSession();
  const { connection } = useConnection();
  const channel = getTableButtonClickChannel(tableId);
  const presence = connection?.getPresence(channel);
  const [statusMap, setStatusMap] = useState<IButtonClickStatus>({});
  const toastMapRef = useRef<Record<string, number | string | undefined>>({});
  const { t } = useTranslation();

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
        setStatusMap(remoteStatus ?? {});
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence.unsubscribe();
      presence?.removeListener('receive', receiveHandler);
    };
  }, [connection, presence, channel, tableId]);

  useEffect(() => {
    const sourceId = Object.keys(statusMap).find((key) => key.startsWith(`${user?.id}-${tableId}`));
    if (!sourceId) {
      return;
    }

    const status = statusMap[sourceId] ?? {};

    const toastId = toastMapRef.current[sourceId];
    const { loading, name, message, errorMessage } = status;
    if (errorMessage) {
      toast.error(t('common.runStatus.failed', { name }), {
        id: toastId ?? undefined,
      });
      toastMapRef.current[sourceId] = undefined;
    }

    if (!message) return;

    if (loading) {
      const newToastId = toast.loading(t('common.runStatus.running', { name }), {
        id: toastId ?? undefined,
      });
      toastMapRef.current[sourceId] = newToastId;
    } else {
      toast.success(t('common.runStatus.success', { name }), {
        id: toastId ?? undefined,
      });
      toastMapRef.current[sourceId] = undefined;
    }
  }, [statusMap, user, tableId, t]);

  const getCellStatus = (recordId: string, fieldId: string) => {
    return statusMap[`${user?.id}-${tableId}-${recordId}-${fieldId}`] ?? {};
  };

  return { getCellStatus };
};
