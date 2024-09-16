import { useQuery } from '@tanstack/react-query';
import { IdPrefix, getTableCommentChannel } from '@teable/core';
import type { IGetRecordsRo, ICommentCountVo } from '@teable/openapi';
import { getCommentCount, CommentPatchType } from '@teable/openapi';
import { get } from 'lodash';
import { useMemo, useEffect, useState } from 'react';
import { ReactQueryKeys } from '../config';
import { useConnection } from './use-connection';
import { useSearch } from './use-search';
import { useTableId } from './use-table-id';
import { useViewId } from './use-view-id';

export const useCommentCountMap = (query?: IGetRecordsRo) => {
  const tableId = useTableId();

  const viewId = useViewId();

  const { searchQuery } = useSearch();

  const { connection } = useConnection();

  const queryParams = useMemo<IGetRecordsRo>(() => {
    return {
      viewId,
      search: searchQuery,
      type: IdPrefix.Record,
      ...query,
      groupBy: query?.groupBy ? JSON.stringify(query?.groupBy) : query?.groupBy,
      filter: query?.filter ? JSON.stringify(query?.filter) : query?.filter,
      orderBy: query?.orderBy ? JSON.stringify(query?.orderBy) : query?.orderBy,
    } as IGetRecordsRo;
  }, [query, searchQuery, viewId]);

  const { data } = useQuery({
    queryKey: ReactQueryKeys.commentCount(tableId!, queryParams),
    queryFn: () => getCommentCount(tableId!, queryParams).then(({ data }) => data),
    enabled: !!tableId,
  });

  const [commentCount, setCommentCount] = useState<ICommentCountVo>([]);

  useEffect(() => {
    data && setCommentCount(data);
  }, [data]);

  useEffect(() => {
    if (!tableId) {
      return;
    }

    const presenceKey = getTableCommentChannel(tableId);
    const presence = connection.getPresence(presenceKey);

    if (!presence || !connection) {
      return;
    }

    presence.subscribe();

    const receiveHandler = () => {
      const { remotePresences } = presence;
      const remoteData = get(remotePresences, presenceKey);
      if (remoteData) {
        const remoteRecordId = remoteData.data.recordId;
        setCommentCount((pre) => {
          const index = pre.findIndex((com) => com.recordId === remoteRecordId);
          if (index > -1) {
            remoteData.type === CommentPatchType.CreateComment && pre[index].count++;
            remoteData.type === CommentPatchType.DeleteComment && pre[index].count--;
            pre?.[index].count === 0 && pre.splice(index, 1);
          } else {
            remoteData.type === CommentPatchType.CreateComment &&
              pre.push({
                recordId: remoteRecordId,
                count: 1,
              });
          }
          return [...pre];
        });
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence.unsubscribe();
      presence?.removeListener('receive', receiveHandler);
    };
  }, [connection, tableId]);

  return useMemo(() => {
    return Object.fromEntries(commentCount.map((item) => [item.recordId, item.count]));
  }, [commentCount]);
};
