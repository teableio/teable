import type { IViewVo, ISort, IColumnMetaRo, IFilter, IGroup } from '@teable-group/core';
import { ViewContext, createViewInstance, useView } from '@teable-group/sdk';
import type { IViewInstance } from '@teable-group/sdk';
import { useEffect, useState } from 'react';

type IProxyViewKey = 'filter' | 'sort' | 'rowHeight';

const enableKey = ['filter', 'sort'];

interface IViewProxyProps {
  proxyKeys?: IProxyViewKey[];
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

export const ViewProxy = (props: IViewProxyProps) => {
  const { proxyKeys, serverData, children } = props;
  const view = useView();
  const [proxyView, setProxyView] = useState<IProxyView>();
  const [viewData, setViewData] = useState<IViewVo>();
  useEffect(() => {
    const data = view?.['doc']?.data || serverData?.[0];
    if (!data) {
      return;
    }
    const enableValue = enableKey.reduce((acc, key) => {
      acc[key] = null;
      return acc;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, {} as any);
    setViewData((viewData) => ({ ...data, ...enableValue, ...viewData }));
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
  }, [viewData, proxyKeys, view?.id]);

  return (
    <ViewContext.Provider value={{ views: (proxyView ? [proxyView] : []) as IViewInstance[] }}>
      {children}
    </ViewContext.Provider>
  );
};
