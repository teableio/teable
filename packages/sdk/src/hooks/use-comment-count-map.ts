import { useQuery } from '@tanstack/react-query';
import { IdPrefix, getTableCommentChannel } from '@teable/core';
import type { IGetRecordsRo, ICommentCountVo } from '@teable/openapi';
import { getCommentCount, CommentPatchType, saveQueryParams } from '@teable/openapi';
import { get } from 'lodash';
import { useMemo, useEffect, useState } from 'react';
import { LARGE_QUERY_THRESHOLD } from '../components/grid-enhancements/hooks/constant';
import { ReactQueryKeys } from '../config';
import { useConnection } from './use-connection';
import { useSearch } from './use-search';
import { useTableId } from './use-table-id';
import { useView } from './use-view';
import { useViewId } from './use-view-id';

export const useCommentCountMap = (query?: IGetRecordsRo) => {
  const tableId = useTableId();

  const viewId = useViewId();

  const view = useView();

  const { searchQuery } = useSearch();

  const { connection } = useConnection();

  const queryParams = useMemo<IGetRecordsRo>(() => {
    return {
      viewId,
      search: searchQuery,
      type: IdPrefix.Record,
      ...query,
      groupBy: query?.groupBy,
      filter: view?.filter,
      orderBy: view?.sort?.sortObjs,
    } as IGetRecordsRo;
  }, [query, searchQuery, viewId, view]);

  const { data } = useQuery({
    queryKey: ReactQueryKeys.commentCount(tableId!, queryParams),
    queryFn: async () => {
      const { collapsedGroupIds, ...rest } = queryParams;

      if (collapsedGroupIds && collapsedGroupIds.length > LARGE_QUERY_THRESHOLD) {
        const { data } = await saveQueryParams({ params: { collapsedGroupIds } });
        return getCommentCount(tableId!, { ...rest, queryId: data.queryId }).then(
          ({ data }) => data
        );
      }
      return getCommentCount(tableId!, queryParams).then(({ data }) => data);
    },
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
    const presence = connection?.getPresence(presenceKey);

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
      presence?.removeListener('receive', receiveHandler);
      presence?.listenerCount('receive') === 0 && presence?.unsubscribe();
      presence?.listenerCount('receive') === 0 && presence?.destroy();
    };
  }, [connection, tableId]);

  return useMemo(() => {
    return Object.fromEntries(commentCount.map((item) => [item.recordId, item.count]));
  }, [commentCount]);
};
