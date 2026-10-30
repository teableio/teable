import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IUserLastVisitMapVo } from '@teable/openapi';
import { getUserLastVisitMap, LastVisitResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useTables } from '@teable/sdk/hooks';
import { useIsReadOnlyPreview } from '@teable/sdk/hooks/use-is-readonly-preview';
import { useCallback, useMemo } from 'react';
import { useShareUrlPrefix } from '../../context/ShareContext';

const lastVisitMapQuery = (baseId: string) => ({
  queryKey: ReactQueryKeys.userLastVisitMap(baseId),
  queryFn: () =>
    getUserLastVisitMap({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: baseId,
    }).then((res) => res.data),
});

const buildTableHref = (
  baseId: string | undefined,
  tables: ReturnType<typeof useTables>,
  userLastVisitMap: IUserLastVisitMapVo | undefined,
  shareUrlPrefix: string
) => {
  const hrefMap: Record<string, string> = {};
  const viewIdMap: Record<string, string> = {};
  tables.forEach((table) => {
    const viewId = userLastVisitMap?.[table.id]?.resourceId || table.defaultViewId;
    viewIdMap[table.id] = viewId;
    // Add share URL prefix if present
    hrefMap[table.id] = `${shareUrlPrefix}/base/${baseId}/table/${table.id}/${viewId}`;
  });
  return { hrefMap, viewIdMap };
};

/**
 * `enabled = false` defers the last-visited views until `loadTableHref` is called, for a caller
 * that only needs them at the moment of a jump; until then the maps point at default views.
 */
export const useTableHref = (
  enabled = true
): {
  hrefMap: Record<string, string>;
  viewIdMap: Record<string, string>;
  loadTableHref: () => Promise<{
    hrefMap: Record<string, string>;
    viewIdMap: Record<string, string>;
  }>;
} => {
  const baseId = useBaseId();
  const tables = useTables();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const shareUrlPrefix = useShareUrlPrefix();
  const queryClient = useQueryClient();
  const lastVisitAllowed = !isReadOnlyPreview && !shareUrlPrefix;
  const { data: userLastVisitMap } = useQuery({
    ...lastVisitMapQuery(baseId as string),
    enabled: enabled && lastVisitAllowed,
  });

  const loadTableHref = useCallback(async () => {
    const lastVisit =
      baseId && lastVisitAllowed
        ? await queryClient.fetchQuery(lastVisitMapQuery(baseId)).catch(() => undefined)
        : undefined;
    return buildTableHref(baseId, tables, lastVisit, shareUrlPrefix);
  }, [baseId, lastVisitAllowed, queryClient, shareUrlPrefix, tables]);

  return useMemo(
    () => ({
      ...buildTableHref(baseId, tables, userLastVisitMap, shareUrlPrefix),
      loadTableHref,
    }),
    [baseId, tables, userLastVisitMap, shareUrlPrefix, loadTableHref]
  );
};
