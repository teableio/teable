import type { IGetRecordsRo } from '@teable/openapi';
import { useCallback, useMemo } from 'react';
import { useFields, useSearch, useView, useViewId } from '../../../hooks';
import type { GridView } from '../../../model';
import { useGridCollapsedGroupStore } from '../store';

export const useGridCollapsedGroup = (cacheKey: string, initQuery?: IGetRecordsRo) => {
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const allFields = useFields({ withHidden: true, withDenied: true });
  // Prefer an already-stripped initQuery.groupBy (PersonalViewProvider) so
  // this hook cannot undo that strip by re-sending raw view.group.
  const readableFieldIds = useMemo(
    () =>
      allFields.length
        ? new Set(
            allFields.filter((field) => field.canReadFieldRecord !== false).map(({ id }) => id)
          )
        : undefined,
    [allFields]
  );
  const groupBy = useMemo(() => {
    const rawGroupBy = initQuery?.groupBy ?? view?.group ?? undefined;
    if (!rawGroupBy?.length || !readableFieldIds) {
      return rawGroupBy;
    }
    const filtered = rawGroupBy.filter((item) => readableFieldIds.has(item.fieldId));
    return filtered.length ? filtered : undefined;
  }, [initQuery?.groupBy, readableFieldIds, view?.group]);
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
