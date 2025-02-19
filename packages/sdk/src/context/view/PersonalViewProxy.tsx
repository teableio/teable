import type { IViewVo, ISort, IColumnMetaRo, IFilter, IGroup, IColumnMeta } from '@teable/core';
import { defaults } from 'lodash';
import { useCallback, useEffect, useMemo } from 'react';
import { generateLocalId, useGridCollapsedGroupStore } from '../../components';
import { useTableId, useViews } from '../../hooks';
import type { IViewInstance } from '../../model/view/factory';
import { createViewInstance } from '../../model/view/factory';
import { usePersonalViewStore } from './store';
import { ViewContext } from './ViewContext';

interface IPersonalViewProxyProps {
  serverData?: IViewVo[];
  children: React.ReactNode;
}

export interface IProxyPersonalView
  extends Omit<
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
  return (view?.['doc']?.data || initData?.find((v) => v.id === view?.id))!;
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
  const { personalViewMap, isPersonalView, setPersonalViewMap } = usePersonalViewStore();

  const generateProxyView = useCallback(
    (view: IViewInstance, serverData?: IViewVo[]) => {
      const viewData = getViewData(view, serverData);
      const viewId = viewData.id;
      const newViewProxy = createViewInstance(viewData) as IProxyPersonalView;
      const cachedView = personalViewMap?.[viewId];
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
        setPersonalViewMap(viewId, (prev) => ({
          ...prev,
          sort,
        }));
      };
      newViewProxy.updateGroup = (group: IGroup) => {
        setPersonalViewMap(viewId, (prev) => ({
          ...prev,
          group,
        }));
        setCollapsedGroupMap(generateLocalId(tableId, view.id), []);
      };
      newViewProxy.updateOption = (options: Record<string, unknown>) => {
        setPersonalViewMap(viewId, (prev) => ({
          ...prev,
          options: { ...(prev.options ?? {}), ...options },
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
              ...(prev.columnMeta ?? {}),
              ...columnMetaMap,
            },
          };
        });
      };
      newViewProxy.syncViewProperties = async () => {
        const cachedView = personalViewMap?.[viewId];
        if (!cachedView || !view) return;

        if (JSON.stringify(cachedView.filter) !== JSON.stringify(viewData.filter)) {
          await view.updateFilter((cachedView.filter as IFilter) ?? null);
        }
        if (JSON.stringify(cachedView.sort) !== JSON.stringify(viewData.sort)) {
          await view.updateSort((cachedView.sort as ISort) ?? null);
        }
        if (JSON.stringify(cachedView.group) !== JSON.stringify(viewData.group)) {
          await view.updateGroup((cachedView.group as IGroup) ?? null);
          setCollapsedGroupMap(generateLocalId(tableId, view.id), []);
          view.group = cachedView.group as IGroup;
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
    [tableId, personalViewMap, setPersonalViewMap, setCollapsedGroupMap]
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
