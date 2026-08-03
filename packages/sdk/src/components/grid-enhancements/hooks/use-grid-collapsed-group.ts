import type { IGetRecordsRo } from '@teable/openapi';
import { useCallback, useMemo } from 'react';
import { useView, useViewId, useSearch } from '../../../hooks';
import type { GridView } from '../../../model';
import { useGridCollapsedGroupStore } from '../store';

export const useGridCollapsedGroup = (cacheKey: string, initQuery?: IGetRecordsRo) => {
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
                ...initQuery,
                groupBy,
              }
            : initQuery,
        }
      : {
          viewQuery: groupBy?.length
            ? {
                ...initQuery,
                groupBy,
                collapsedGroupIds: collapsedGroupIds ? Array.from(collapsedGroupIds) : undefined,
              }
            : initQuery,
          collapsedGroupIds,
          onCollapsedGroupChanged,
        };
  }, [value, groupBy, collapsedGroupIds, initQuery, onCollapsedGroupChanged]);
};
