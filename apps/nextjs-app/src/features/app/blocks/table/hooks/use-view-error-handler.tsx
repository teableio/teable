import { useMutation } from '@tanstack/react-query';
import { HttpError, HttpErrorCode } from '@teable/core';
import { BaseNodeResourceType, getTableById } from '@teable/openapi';
import { useConnection } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useEffect, useRef } from 'react';
import type { ConnectionReceiveRequest } from 'sharedb/lib/sharedb';
import { getNodeUrl } from '../../base/base-node/hooks';

export const useViewErrorHandler = (baseId: string, tableId: string, viewId: string) => {
  const router = useRouter();
  const { connection } = useConnection();
  const redirectLockRef = useRef(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { mutate: redirectDefaultView } = useMutation({
    mutationFn: ({ baseId, tableId }: { baseId: string; tableId: string }) =>
      getTableById(baseId, tableId),
    onSuccess: (data) => {
      redirectLockRef.current = false;
      const defaultViewId = data.data.defaultViewId;
      const url = getNodeUrl({
        baseId,
        resourceType: BaseNodeResourceType.Table,
        resourceId: tableId,
        viewId: defaultViewId,
      });
      if (url) {
        router.replace(url, undefined, { shallow: true });
      }
    },
    onError: () => {
      redirectLockRef.current = false;
    },
  });

  useEffect(() => {
    if (!tableId || !baseId || !connection) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorHandler = (error: any) => {
      const httpError = new HttpError(error, error?.status || 500);
      if (httpError.code === HttpErrorCode.VIEW_NOT_FOUND) {
        if (redirectLockRef.current) return;
        redirectLockRef.current = true;
        redirectDefaultView({ baseId, tableId });
      }
    };

    const handleViewDeletion = (data: unknown) => {
      if (typeof data === 'object' && data !== null) {
        const { d, del } = data as { d?: string; del?: boolean };
        if (d === viewId && del === true) {
          // If user deletes the view and immediately navigates to another view,
          // don't compete; delay and check we are still on the deleted view.
          if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
          redirectTimerRef.current = setTimeout(() => {
            if (redirectLockRef.current) return;
            if (router.asPath.includes(`/${tableId}/${viewId}`)) {
              redirectLockRef.current = true;
              redirectDefaultView({ baseId, tableId });
            }
          }, 100);
        }
      }
    };

    const onReceive = (request: ConnectionReceiveRequest) => {
      if (request.data.error) {
        errorHandler(request.data.error);
      } else {
        handleViewDeletion(request.data);
      }
    };
    connection.on('receive', onReceive);

    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
      connection.removeListener('receive', onReceive);
    };
  }, [baseId, connection, redirectDefaultView, router.asPath, tableId, viewId]);
};
