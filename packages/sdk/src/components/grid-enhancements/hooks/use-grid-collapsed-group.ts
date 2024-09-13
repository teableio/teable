import { useCallback, useMemo } from 'react';
import { useView, useViewId } from '../../../hooks';
import type { GridView } from '../../../model';
import { useGridCollapsedGroupStore } from '../store';

export const useGridCollapsedGroup = (cacheKey: string) => {
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const groupBy = view?.group;

  const { collapsedGroupMap, setCollapsedGroupMap } = useGridCollapsedGroupStore();

  const collapsedGroupIds = useMemo(() => {
    const collapsedGroupIds = collapsedGroupMap?.[cacheKey];
    return collapsedGroupIds?.length ? new Set(collapsedGroupIds) : null;
  }, [cacheKey, collapsedGroupMap]);

  const onCollapsedGroupChanged = useCallback(
    (groupIds: Set<string>) => {
      setCollapsedGroupMap(cacheKey, [...groupIds]);
    },
    [cacheKey, setCollapsedGroupMap]
  );

  return useMemo(() => {
    return {
      viewQuery: groupBy?.length
        ? {
            groupBy,
            collapsedGroupIds: collapsedGroupIds ? Array.from(collapsedGroupIds) : undefined,
          }
        : undefined,
      collapsedGroupIds,
      onCollapsedGroupChanged,
    };
  }, [collapsedGroupIds, onCollapsedGroupChanged, groupBy]);
};
