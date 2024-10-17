import type { IViewVo, ISort, IColumnMetaRo, IFilter, IGroup } from '@teable/core';
import { useEffect, useState } from 'react';
import { useView } from '../../hooks/use-view';
import type { IViewInstance } from '../../model/view/factory';
import { createViewInstance } from '../../model/view/factory';
import { ViewContext } from '../view/ViewContext';

// Properties that don't need to be updated when view updates come from op
const enableKey = ['filter', 'sort'];

interface IViewProxyProps {
  serverData?: IViewVo[];
  children: React.ReactNode;
}

type IProxyViewInstance = Omit<
  IViewInstance,
  'updateFilter' | 'updateSort' | 'updateGroup' | 'updateOption' | 'updateColumnMeta'
>;

interface IProxyView extends IProxyViewInstance {
  updateFilter: (filter: IFilter) => void;
  updateSort: (sort: ISort) => void;
  updateGroup: (group: IGroup) => void;
  updateOption: (option: object) => void;
  updateColumnMeta: (columnMeta: IColumnMetaRo) => void;
}

export const getViewData = (view?: IViewInstance, initData?: IViewVo[]) => {
  const data = view?.['doc']?.data || initData?.[0];
  if (!data) {
    return;
  }
  const enableValue = enableKey.reduce((acc, key) => {
    acc[key] = null;
    return acc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, {} as any);
  return { ...data, ...enableValue };
};

export const ShareViewProxy = (props: IViewProxyProps) => {
  const { serverData, children } = props;
  const view = useView();
  const [viewData, setViewData] = useState<IViewVo>(getViewData(view, serverData));
  const [proxyView, setProxyView] = useState<IProxyView | undefined>(() => {
    if (!viewData || !view?.id) return;
    return createViewInstance(viewData) as IProxyView;
  });

  useEffect(() => {
    setViewData((viewData) => ({ ...getViewData(view, serverData), ...viewData }));
  }, [serverData, view]);

  useEffect(() => {
    if (!viewData || !view?.id) return;
    const newViewProxy = createViewInstance(viewData) as IProxyView;
    newViewProxy.updateSort = (sort: ISort) => {
      setViewData({
        ...viewData,
        sort,
      });
    };

    newViewProxy.updateFilter = (filter: IFilter) => {
      setViewData({
        ...viewData,
        filter,
      });
    };

    newViewProxy.updateGroup = (group: IGroup) => {
      setViewData({
        ...viewData,
        group,
      });
    };

    newViewProxy.updateOption = (option: object) => {
      setViewData({
        ...viewData,
        options: {
          ...(viewData?.options ?? {}),
          ...option,
        },
      });
    };
    newViewProxy.updateColumnMeta = (columnMeta: IColumnMetaRo) => {
      const [{ columnMeta: meta, fieldId }] = columnMeta;
      const newViewData = {
        ...viewData,
        columnMeta: {
          ...viewData.columnMeta,
          [fieldId]: {
            ...viewData.columnMeta?.[fieldId],
            ...meta,
          },
        },
      };
      setViewData(newViewData);
    };
    setProxyView(newViewProxy);
  }, [viewData, view?.id]);

  return (
    <ViewContext.Provider value={{ views: (proxyView ? [proxyView] : []) as IViewInstance[] }}>
      {children}
    </ViewContext.Provider>
  );
};
