import type {
  IOtOperation,
  IViewVo,
  ISort,
  IColumnMetaRo,
  IFilter,
  IGroup,
} from '@teable-group/core';
import { ViewContext, createViewInstance, useView } from '@teable-group/sdk';
import type { IViewInstance } from '@teable-group/sdk';
import { useEffect, useRef, useState } from 'react';

type IProxyViewKey = 'filter' | 'sort' | 'rowHeight';

const enableKey = ['filter', 'sort'];

interface IViewProxyProps {
  proxyKeys?: IProxyViewKey[];
  serverData?: IViewVo[];
  children: React.ReactNode;
}

type IProxyViewInstance = Omit<
  IViewInstance,
  'setViewFilter' | 'setViewSort' | 'setViewGroup' | 'setOption' | 'setViewColumnMeta'
>;

interface IProxyView extends IProxyViewInstance {
  setViewFilter: (filter: IFilter) => void;
  setViewSort: (sort: ISort) => void;
  setViewGroup: (group: IGroup) => void;
  setOption: (option: object) => void;
  setViewColumnMeta: (columnMeta: IColumnMetaRo) => void;
}

export const ViewProxy = (props: IViewProxyProps) => {
  const { proxyKeys, serverData, children } = props;
  const view = useView();
  const [proxyView, setProxyView] = useState<IProxyView>();
  const [viewData, setViewData] = useState<IViewVo>();
  const viewSubmitOperation = useRef<((operation: IOtOperation) => Promise<unknown>) | undefined>(
    view?.submitOperation
  );

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
    newViewProxy.setViewSort = (sort: ISort) => {
      setViewData({
        ...viewData,
        sort,
      });
    };

    newViewProxy.setViewFilter = (filter: IFilter) => {
      setViewData({
        ...viewData,
        filter,
      });
    };

    newViewProxy.setViewGroup = (group: IGroup) => {
      setViewData({
        ...viewData,
        group,
      });
    };

    newViewProxy.setOption = (option: object) => {
      setViewData({
        ...viewData,
        options: {
          ...(viewData?.options ?? {}),
          ...option,
        },
      });
    };
    newViewProxy.setViewColumnMeta = (columnMeta: IColumnMetaRo) => {
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
    return () => (viewSubmitOperation.current = undefined);
  }, [viewData, proxyKeys, view?.id]);

  return (
    <ViewContext.Provider value={{ views: (proxyView ? [proxyView] : []) as IViewInstance[] }}>
      {children}
    </ViewContext.Provider>
  );
};
