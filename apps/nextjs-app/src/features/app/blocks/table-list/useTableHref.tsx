import { useQuery } from '@tanstack/react-query';
import { getUserLastVisitMap, LastVisitResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useTables } from '@teable/sdk/hooks';
import { useIsTemplate } from '@teable/sdk/hooks/use-is-template';
import { useMemo } from 'react';

export const useTableHref = (): {
  hrefMap: Record<string, string>;
  viewIdMap: Record<string, string>;
} => {
  const baseId = useBaseId();
  const tables = useTables();
  const isTemplate = useIsTemplate();
  const { data: userLastVisitMap } = useQuery({
    queryKey: ReactQueryKeys.userLastVisitMap(baseId as string),
    queryFn: ({ queryKey }) =>
      getUserLastVisitMap({
        resourceType: LastVisitResourceType.Table,
        parentResourceId: queryKey[1],
      }).then((res) => res.data),
    enabled: !isTemplate,
  });

  return useMemo(() => {
    const hrefMap: Record<string, string> = {};
    const viewIdMap: Record<string, string> = {};
    tables.forEach((table) => {
      const viewId = userLastVisitMap?.[table.id]?.resourceId || table.defaultViewId;
      viewIdMap[table.id] = viewId;
      hrefMap[table.id] = `/base/${baseId}/table/${table.id}/${viewId}`;
    });
    return { hrefMap, viewIdMap };
  }, [baseId, tables, userLastVisitMap]);
};
