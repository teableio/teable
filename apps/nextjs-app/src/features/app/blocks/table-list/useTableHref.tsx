import { useQuery } from '@tanstack/react-query';
import { getUserLastVisitMap, LastVisitResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useTables } from '@teable/sdk/hooks';
import { useMemo } from 'react';

export const useTableHref = () => {
  const baseId = useBaseId();
  const tables = useTables();
  const { data: userLastVisitMap } = useQuery({
    queryKey: ReactQueryKeys.userLastVisitMap(baseId as string),
    queryFn: ({ queryKey }) =>
      getUserLastVisitMap({
        resourceType: LastVisitResourceType.Table,
        parentResourceId: queryKey[1],
      }).then((res) => res.data),
  });

  return useMemo(() => {
    const map: Record<string, string> = {};
    tables.forEach((table) => {
      map[table.id] =
        `/base/${baseId}/${table.id}/${userLastVisitMap?.[table.id]?.resourceId || table.defaultViewId}`;
    });
    return map;
  }, [baseId, tables, userLastVisitMap]);
};
