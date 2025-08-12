import { getTableButtonClickChannel } from '@teable/core';
import { sonner } from '@teable/ui-lib';
import { isEmpty, get } from 'lodash';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../context/app/i18n';
import { useConnection } from './use-connection';

export interface IButtonClickStatus {
  runId: string;
  recordId: string;
  fieldId: string;
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
  // runId => status
  const statusMapRef = useRef<Record<string, IButtonClickStatus>>({});
  const toastMapRef = useRef<Record<string, number | string | undefined>>({});
  const { t } = useTranslation();

  const checkLoading = (fieldId: string, recordId: string) => {
    return statusMapRef.current[`${recordId}-${fieldId}`]?.loading ?? false;
  };

  const setStatus = useCallback(
    (status: IButtonClickStatus) => {
      const { runId } = status;
      const toastId = toastMapRef.current[runId];
      const { loading, name, errorMessage, recordId, fieldId } = status;

      if (loading) {
        const newToastId = toast.loading(t('common.runStatus.running', { name }), {
          id: toastId ?? undefined,
        });
        toastMapRef.current[runId] = newToastId;
        return;
      }

      if (toastId && errorMessage) {
        toast.error(t('common.runStatus.failed', { name }), {
          id: toastId,
        });
        toastMapRef.current[runId] = undefined;
        return;
      }

      if (toastId && !loading) {
        toast.success(t('common.runStatus.success', { name }), {
          id: toastId,
        });
        toastMapRef.current[runId] = undefined;
      }

      statusMapRef.current[`${recordId}-${fieldId}`] = status;
    },
    [t]
  );

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
          setStatus(remoteStatus);
        }
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence?.removeListener('receive', receiveHandler);
      presence?.listenerCount('receive') === 0 && presence?.unsubscribe();
      presence?.listenerCount('receive') === 0 && presence?.destroy();
    };
  }, [connection, presence, channel, setStatus]);

  return { checkLoading, setStatus };
};

export type IButtonClickStatusHook = ReturnType<typeof useButtonClickStatus>;
