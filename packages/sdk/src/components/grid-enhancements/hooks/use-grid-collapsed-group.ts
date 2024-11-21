import { useCallback, useMemo } from 'react';
import { useView, useViewId, useSearch } from '../../../hooks';
import type { GridView } from '../../../model';
import { useGridCollapsedGroupStore } from '../store';

export const useGridCollapsedGroup = (cacheKey: string) => {
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const groupBy = view?.group;
  const { value } = useSearch();

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
    // expand all group when searching
    return value
      ? {
          viewQuery: groupBy?.length
            ? {
                groupBy,
              }
            : undefined,
        }
      : {
          viewQuery: groupBy?.length
            ? {
                groupBy,
                collapsedGroupIds: collapsedGroupIds ? Array.from(collapsedGroupIds) : undefined,
              }
            : undefined,
          collapsedGroupIds,
          onCollapsedGroupChanged,
        };
  }, [value, onCollapsedGroupChanged, groupBy, collapsedGroupIds]);
};
