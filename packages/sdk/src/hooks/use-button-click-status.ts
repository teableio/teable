import { getTableButtonClickChannel } from '@teable/core';
import { sonner } from '@teable/ui-lib';
import { isEmpty, get } from 'lodash';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../context/app/i18n';
import { useConnection } from './use-connection';

export interface IButtonClickStatus {
  loading: boolean;
  name: string;
  message?: string;
  errorMessage?: string;
}

const { toast } = sonner;

export const useButtonClickStatus = (tableId: string) => {
  const { connection } = useConnection();
  const channel = getTableButtonClickChannel(tableId);
  const presence = connection?.getPresence(channel);
  const [statusMap, setStatusMap] = useState<Record<string, IButtonClickStatus>>({});
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
        if (remoteStatus) {
          setStatusMap((prev) => ({ ...prev, ...remoteStatus }));
        }
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence?.removeListener('receive', receiveHandler);
      presence?.listenerCount('receive') === 0 && presence?.unsubscribe();
      presence?.listenerCount('receive') === 0 && presence?.destroy();
    };
  }, [connection, presence, channel, tableId]);

  useEffect(() => {
    const sourceId = Object.keys(statusMap).find((key) => key.startsWith(`${tableId}`));
    if (!sourceId) {
      return;
    }

    const status = statusMap[sourceId];
    if (!status) {
      return;
    }

    const toastId = toastMapRef.current[sourceId];
    const { loading, name, errorMessage } = status;
    if (errorMessage) {
      toast.error(t('common.runStatus.failed', { name }), {
        id: toastId ?? undefined,
      });
      toastMapRef.current[sourceId] = undefined;
      return;
    }

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
  }, [statusMap, tableId, t]);

  const buildSourceId = (tableId: string, recordId: string, fieldId: string) => {
    return `${tableId}-${recordId}-${fieldId}`;
  };

  const checkLoading = useCallback(
    (recordId: string, fieldId: string) => {
      return statusMap[buildSourceId(tableId, recordId, fieldId)]?.loading ?? false;
    },
    [statusMap, tableId]
  );

  const setStatus = (
    tableId: string,
    recordId: string,
    fieldId: string,
    status: IButtonClickStatus
  ) => {
    setStatusMap((prev) => ({ ...prev, [buildSourceId(tableId, recordId, fieldId)]: status }));
  };

  return { checkLoading, setStatus };
};

export type IButtonClickStatusHook = ReturnType<typeof useButtonClickStatus>;
