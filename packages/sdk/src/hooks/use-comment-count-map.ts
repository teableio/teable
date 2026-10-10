import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getTableCommentChannel } from '@teable/core';
import type { ICommentCountVo } from '@teable/openapi';
import { getCommentCount, CommentPatchType, MAX_COMMENT_COUNT_RECORDS } from '@teable/openapi';
import { chunk, get } from 'lodash';
import { useMemo, useEffect, useRef } from 'react';
import { ReactQueryKeys } from '../config';
import { useCommentPermission } from './use-comment-permission';
import { useConnection } from './use-connection';
import { useTableId } from './use-table-id';

export const useCommentCountMap = (recordIds: string[]) => {
  const tableId = useTableId();
  const queryClient = useQueryClient();
  const { connection } = useConnection();
  // Whoever cannot open the comments has no business knowing they exist: the
  // count badge follows the same gate as the panel (share links included).
  const { commentReadable } = useCommentPermission();
  const enabled = !!tableId && commentReadable && recordIds.length > 0;
  const requestedIds = useMemo(() => new Set(recordIds), [recordIds]);
  const queryKey = useMemo(
    () => ReactQueryKeys.commentCount(tableId!, recordIds),
    [tableId, recordIds]
  );
  // The grid hands over a fresh recordIds array on every record delivery (each
  // cell edit included). The presence subscription must not follow that churn:
  // tearing it down and re-subscribing costs socket round trips and opens a
  // window where a remote comment broadcast is missed. Keep the subscription
  // bound to the table and read the current window through refs instead.
  const requestedIdsRef = useRef(requestedIds);
  requestedIdsRef.current = requestedIds;
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      // The grid retains neighboring pages, so its loaded window can exceed one request.
      const batches = await Promise.all(
        chunk(recordIds, MAX_COMMENT_COUNT_RECORDS).map((ids) =>
          getCommentCount(tableId!, { recordIds: ids }).then(({ data }) => data)
        )
      );
      return batches.flat();
    },
    enabled,
    // Never inherit keepPreviousData across tables or loaded record windows.
    placeholderData: () => undefined,
  });

  useEffect(() => {
    if (!tableId || !enabled) {
      return;
    }

    const presenceKey = getTableCommentChannel(tableId);
    const presence = connection?.getPresence(presenceKey);

    if (!presence || !connection) {
      return;
    }

    presence.subscribe();

    const receiveHandler = () => {
      const remoteData = get(presence.remotePresences, presenceKey);
      const recordId = remoteData?.data.recordId;
      if (!requestedIdsRef.current.has(recordId)) {
        return;
      }
      const delta =
        remoteData.type === CommentPatchType.CreateComment
          ? 1
          : remoteData.type === CommentPatchType.DeleteComment
            ? -1
            : 0;
      if (!delta) {
        return;
      }

      queryClient.setQueryData<ICommentCountVo>(queryKeyRef.current, (previous) => {
        if (!previous) {
          return previous;
        }
        const existing = previous.find((item) => item.recordId === recordId);
        if (!existing) {
          return delta > 0 ? [...previous, { recordId, count: 1 }] : previous;
        }
        const count = existing.count + delta;
        return count > 0
          ? previous.map((item) => (item.recordId === recordId ? { ...item, count } : item))
          : previous.filter((item) => item.recordId !== recordId);
      });
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence.removeListener('receive', receiveHandler);
      presence.listenerCount('receive') === 0 && presence.unsubscribe();
      presence.listenerCount('receive') === 0 && presence.destroy();
    };
  }, [connection, tableId, enabled, queryClient]);

  return useMemo(() => {
    if (!enabled) {
      return {};
    }
    return Object.fromEntries(
      (data ?? [])
        .filter((item) => requestedIds.has(item.recordId))
        .map((item) => [item.recordId, item.count])
    );
  }, [data, enabled, requestedIds]);
};
