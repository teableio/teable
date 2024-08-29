import { useMutation } from '@tanstack/react-query';
import { HttpError, HttpErrorCode } from '@teable/core';
import { getTableById } from '@teable/openapi';
import { useConnection } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import type { ConnectionReceiveRequest } from 'sharedb/lib/sharedb';

export const useViewErrorHandler = (baseId: string, tableId: string, viewId: string) => {
  const router = useRouter();
  const { connection } = useConnection();

  const { mutate: redirectDefaultView } = useMutation({
    mutationFn: ({ baseId, tableId }: { baseId: string; tableId: string }) =>
      getTableById(baseId, tableId),
    onSuccess: (data) => {
      const defaultViewId = data.data.defaultViewId;
      router.push(
        {
          pathname: '/base/[baseId]/[tableId]/[viewId]',
          query: {
            tableId,
            viewId: defaultViewId,
            baseId,
          },
        },
        undefined,
        { shallow: Boolean(defaultViewId) }
      );
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
        redirectDefaultView({ baseId, tableId });
      }
    };

    const handleViewDeletion = (data: unknown) => {
      if (typeof data === 'object' && data !== null) {
        const { d, del } = data as { d?: string; del?: boolean };
        if (d === viewId && del === true) {
          redirectDefaultView({ baseId, tableId });
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
      connection.removeListener('receive', onReceive);
    };
  }, [baseId, connection, redirectDefaultView, tableId, viewId]);
};
