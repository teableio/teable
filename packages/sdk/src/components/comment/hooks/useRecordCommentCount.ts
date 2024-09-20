import { useQuery } from '@tanstack/react-query';
import { getRecordCommentCount } from '@teable/openapi';
import { ReactQueryKeys } from '../../../config';

export const useRecordCommentCount = (tableId: string, recordId: string, enabled?: boolean) => {
  const { data } = useQuery({
    queryKey: ReactQueryKeys.recordCommentCount(tableId, recordId),
    queryFn: () => {
      if (tableId && recordId) {
        return getRecordCommentCount(tableId, recordId).then(({ data }) => data);
      }
      return Promise.resolve({ count: 0 });
    },
    enabled: !!(tableId && recordId && enabled),
  });

  return data?.count || 0;
};
