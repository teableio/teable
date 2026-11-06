import type { IViewVo, ISort, IColumnMetaRo, IFilter, IGroup, IColumnMeta } from '@teable/core';
import { sonner } from '@teable/ui-lib';
import { defaults } from 'lodash';
import { useCallback, useEffect, useMemo } from 'react';
import { generateLocalId, useGridCollapsedGroupStore } from '../../components';
import { useTableId, useViews } from '../../hooks';
import type { IViewInstance } from '../../model/view/factory';
import { createViewInstance } from '../../model/view/factory';
import { findPinyinSortGroupConflict, removePinyinSortGroupConflicts } from '../../utils/sort';
import { useTranslation } from '../app/i18n';
import { useResolvedPersonalViewStore } from './store';
import { ViewContext } from './ViewContext';

const { toast } = sonner;

interface IPersonalViewProxyProps {
  serverData?: IViewVo[];
  children: React.ReactNode;
}

export interface IProxyPersonalView extends Omit<
  IViewInstance,
  'updateFilter' | 'updateSort' | 'updateGroup' | 'updateOption' | 'updateColumnMeta'
> {
  updateFilter: (filter: IFilter) => void;
  updateSort: (sort: ISort) => void;
  updateGroup: (group: IGroup) => void;
  updateOption: (option: Record<string, unknown>) => void;
  updateColumnMeta: (columnMeta: IColumnMetaRo) => void;
  syncViewProperties?: () => void | Promise<void>;
}

const getViewData = (view?: IViewInstance, initData?: IViewVo[]) => {
  // doc-less (seeded) view instances carry the full VO on the instance
  // itself, so fall back to it when there is no doc and no matching initData
  return (view?.['doc']?.data ||
    initData?.find((v) => v.id === view?.id) ||
    (view as unknown as IViewVo))!;
};

const mergeColumnMeta = (localColumnMeta: IColumnMeta, remoteColumnMeta: IColumnMeta) => {
  const filteredLocalMeta = Object.keys(localColumnMeta).reduce((acc, key) => {
    if (key in remoteColumnMeta) {
      acc[key] = localColumnMeta[key];
    }
    return acc;
  }, {} as IColumnMeta);
  return defaults({}, filteredLocalMeta, remoteColumnMeta);
};

export const PersonalViewProxy = (props: IPersonalViewProxyProps) => {
  const { serverData, children } = props;
  const views = useViews();
  const tableId = useTableId();
  const { setCollapsedGroupMap } = useGridCollapsedGroupStore();
  const { t } = useTranslation();
  const { personalViewMap, isPersonalView, setPersonalViewMap } = useResolvedPersonalViewStore();

  const generateProxyView = useCallback(
    (view: IViewInstance, serverData?: IViewVo[]) => {
      const viewData = getViewData(view, serverData);
      const viewId = viewData.id;
      const newViewProxy = createViewInstance(viewData) as IProxyPersonalView;
      const persistedCachedView = personalViewMap?.[viewId] as IViewVo | undefined;
      const sanitizedSort = removePinyinSortGroupConflicts(
        persistedCachedView?.sort,
        persistedCachedView?.group
      );
      const cachedView =
        persistedCachedView && sanitizedSort !== persistedCachedView.sort
          ? { ...persistedCachedView, sort: sanitizedSort }
          : persistedCachedView;
      newViewProxy.tableId = tableId as string;
      newViewProxy.filter = cachedView?.filter as IFilter;
      newViewProxy.sort = cachedView?.sort as ISort;
      newViewProxy.group = cachedView?.group as IGroup;
      newViewProxy.options = cachedView?.options as Record<string, unknown>;
      const columnMeta = mergeColumnMeta(
        (cachedView?.columnMeta ?? {}) as IColumnMeta,
        viewData.columnMeta
      );
      newViewProxy.columnMeta = columnMeta as IColumnMeta;
      newViewProxy.updateFilter = (filter: IFilter) => {
        setPersonalViewMap(viewId, (prev) => ({
          ...prev,
          filter,
        }));
      };
      newViewProxy.updateSort = (sort: ISort) => {
        let conflict = false;
        setPersonalViewMap(viewId, (prev) => {
          if (findPinyinSortGroupConflict(sort, prev.group as IGroup | undefined)) {
            conflict = true;
            return prev;
          }
          return {
            ...prev,
            sort,
          };
        });
        if (conflict) toast.warning(t('sort.pinyinGroupConflict'));
      };
      newViewProxy.updateGroup = (group: IGroup) => {
        let conflict = false;
        setPersonalViewMap(viewId, (prev) => {
          if (findPinyinSortGroupConflict(prev.sort as ISort | undefined, group)) {
            conflict = true;
            return prev;
          }
          return {
            ...prev,
            group,
          };
        });
        if (conflict) {
          toast.warning(t('group.pinyinSortConflict'));
          return;
        }
        setCollapsedGroupMap(generateLocalId(tableId, view.id), []);
      };
      newViewProxy.updateOption = (options: Record<string, unknown>) => {
        setPersonalViewMap(viewId, (prev) => ({
          ...prev,
          options: { ...(prev.options ?? {}), ...options }, // NOSONAR typescript:S7744 -- the spread source is not typed as an object; the fallback keeps the spread type-safe
        }));
      };
      newViewProxy.updateColumnMeta = (columnMetaRo: IColumnMetaRo) => {
        setPersonalViewMap(viewId, (prev) => {
          const columnMetaMap = columnMetaRo.reduce((acc, { fieldId, columnMeta }) => {
            acc[fieldId] = {
              ...(prev.columnMeta as IColumnMeta)?.[fieldId],
              ...columnMeta,
            };
            return acc;
          }, {} as IColumnMeta);

          return {
            ...prev,
            columnMeta: {
              ...(prev.columnMeta ?? {}), // NOSONAR typescript:S7744 -- the spread source is not typed as an object; the fallback keeps the spread type-safe
              ...columnMetaMap,
            },
          };
        });
      };
      newViewProxy.syncViewProperties = async () => {
        const persistedView = personalViewMap?.[viewId] as IViewVo | undefined;
        if (!persistedView || !view) return;
        const sort = removePinyinSortGroupConflicts(persistedView.sort, persistedView.group);
        const cachedView = sort === persistedView.sort ? persistedView : { ...persistedView, sort };

        if (JSON.stringify(cachedView.filter) !== JSON.stringify(viewData.filter)) {
          await view.updateFilter((cachedView.filter as IFilter) ?? null);
        }
        const sortChanged = JSON.stringify(cachedView.sort) !== JSON.stringify(viewData.sort);
        const groupChanged = JSON.stringify(cachedView.group) !== JSON.stringify(viewData.group);
        const syncSort = async () => {
          if (sortChanged) await view.updateSort((cachedView.sort as ISort) ?? null);
        };
        const syncGroup = async () => {
          if (!groupChanged) return;
          await view.updateGroup((cachedView.group as IGroup) ?? null);
          setCollapsedGroupMap(generateLocalId(tableId, view.id), []);
          view.group = cachedView.group as IGroup;
        };

        // Removing a saved group must land before enabling pinyin on that field;
        // the opposite transition must change the sort first. This keeps every
        // intermediate server state valid instead of relying on a later update.
        if (
          sortChanged &&
          groupChanged &&
          findPinyinSortGroupConflict(cachedView.sort, viewData.group)
        ) {
          if (findPinyinSortGroupConflict(viewData.sort, cachedView.group)) {
            await view.updateSort(
              removePinyinSortGroupConflicts(viewData.sort, cachedView.group) ?? null
            );
          }
          await syncGroup();
          await syncSort();
        } else {
          await syncSort();
          await syncGroup();
        }
        if (JSON.stringify(cachedView.options) !== JSON.stringify(viewData.options)) {
          await view?.updateOption(cachedView.options as Record<string, unknown>);
        }
        if (
          JSON.stringify(cachedView.columnMeta) !== JSON.stringify(viewData.columnMeta) &&
          cachedView.columnMeta
        ) {
          const columnMetaRo: IColumnMetaRo = Object.entries(
            cachedView.columnMeta as IColumnMeta
          ).map(([fieldId, columnMeta]) => ({
            fieldId,
            columnMeta,
          }));
          await view?.updateColumnMeta(columnMetaRo);
        }
      };

      return newViewProxy;
    },
    [tableId, personalViewMap, setPersonalViewMap, setCollapsedGroupMap, t]
  );

  const proxyViews = useMemo(() => {
    if (!tableId || !views?.length) return views ?? [];

    return views.map((view) => {
      if (!isPersonalView(view.id)) return view;
      return generateProxyView(view, serverData);
    });
  }, [views, tableId, serverData, isPersonalView, generateProxyView]);

  useEffect(() => {
    views.forEach((view) => {
      if (!isPersonalView(view.id)) return view;
      // When adding or deleting fields, update columnMeta
      setPersonalViewMap(view.id, (prev) => {
        const columnMeta = mergeColumnMeta(
          (prev?.columnMeta ?? {}) as IColumnMeta,
          view.columnMeta as IColumnMeta
        );
        return {
          ...prev,
          columnMeta,
        };
      });
    });
  }, [isPersonalView, setPersonalViewMap, views]);

  return (
    <ViewContext.Provider value={{ views: proxyViews as IViewInstance[] }}>
      {children}
    </ViewContext.Provider>
  );
};
