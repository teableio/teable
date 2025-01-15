import type { IViewVo, ISort, IColumnMetaRo, IFilter, IGroup, IColumnMeta } from '@teable/core';
import { useCallback, useMemo } from 'react';
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

export const PersonalViewProxy = (props: IPersonalViewProxyProps) => {
  const { serverData, children } = props;
  const views = useViews();
  const tableId = useTableId();
  const { setCollapsedGroupMap } = useGridCollapsedGroupStore();
  const { personalViewMap, setPersonalViewMap } = usePersonalViewStore();

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
      newViewProxy.columnMeta = cachedView?.columnMeta as IColumnMeta;
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
        const [{ columnMeta, fieldId }] = columnMetaRo;
        setPersonalViewMap(viewId, (prev) => ({
          ...prev,
          columnMeta: {
            ...(prev.columnMeta ?? {}),
            [fieldId]: {
              ...(prev.columnMeta as IColumnMeta)?.[fieldId],
              ...columnMeta,
            },
          },
        }));
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
      if (!personalViewMap[view.id]) return view;
      return generateProxyView(view, serverData);
    });
  }, [views, tableId, personalViewMap, serverData, generateProxyView]);

  return (
    <ViewContext.Provider value={{ views: proxyViews as IViewInstance[] }}>
      {children}
    </ViewContext.Provider>
  );
};
