import { useQuery } from '@tanstack/react-query';
import type { ITableQuery } from '@teable/openapi';
import { getFields } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useStorage } from './useStorage';

export const useFields = () => {
  const { storage } = useStorage();
  const { query } = storage || {};
  const { tableId } = (query || {}) as ITableQuery;

  const { data: fields = [] } = useQuery({
    queryKey: ReactQueryKeys.fieldList(tableId),
    queryFn: () => getFields(tableId).then((res) => res.data),
    enabled: !!tableId,
    meta: { preventGlobalError: true },
  });

  return { fields };
};
