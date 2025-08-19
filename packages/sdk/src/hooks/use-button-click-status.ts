import { useMutation } from '@tanstack/react-query';
import { getTableButtonClickChannel } from '@teable/core';
import { buttonClick as buttonClickApi } from '@teable/openapi/src/record/button-click';
import { sonner } from '@teable/ui-lib';
import { isEmpty, get } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [statusMap, setStatusMap] = useState<Record<string, IButtonClickStatus>>({});
  const toastMapRef = useRef<Record<string, number | string | undefined>>({});
  const { t } = useTranslation();

  const { mutateAsync: buttonClick } = useMutation({
    mutationFn: (ro: { tableId: string; recordId: string; fieldId: string; name: string }) =>
      buttonClickApi(ro.tableId, ro.recordId, ro.fieldId),
    onSuccess: (res, ro) => {
      setStatus({
        runId: res.data.runId,
        recordId: ro.recordId,
        fieldId: ro.fieldId,
        loading: true,
        name: ro.name,
      });
    },
  });

  const checkLoading = useCallback(
    (fieldId: string, recordId: string) => {
      return statusMap[`${recordId}-${fieldId}`]?.loading ?? false;
    },
    [statusMap]
  );

  const setStatus = useCallback(
    (status: IButtonClickStatus) => {
      const { runId } = status;
      if (!runId) {
        return;
      }
      const toastId = toastMapRef.current[runId];
      const { loading, name, errorMessage, recordId, fieldId } = status;

      setStatusMap((prev) => ({
        ...prev,
        [`${recordId}-${fieldId}`]: status,
      }));
      if (loading) {
        const newToastId = toast.loading(t('common.runStatus.running', { name }), {
          id: toastId ?? undefined,
        });
        toastMapRef.current[runId] = newToastId;
        return;
      }
      setStatusMap((prev) => {
        const newMap = { ...prev };
        delete newMap[`${recordId}-${fieldId}`];
        return newMap;
      });
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

  return useMemo(() => {
    return { checkLoading, setStatus, buttonClick };
  }, [checkLoading, setStatus, buttonClick]);
};

export type IButtonClickStatusHook = ReturnType<typeof useButtonClickStatus>;
