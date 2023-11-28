import type { IOtOperation, IViewVo } from '@teable-group/core';
import type { IViewInstance } from '@teable-group/sdk';
import { ViewContext, createViewInstance, useView } from '@teable-group/sdk';
import { useEffect, useRef, useState } from 'react';

type IProxyViewKey = 'filter' | 'sort' | 'rowHeight';

const enableKey = ['filter', 'sort'];

interface IViewProxyProps {
  proxyKeys?: IProxyViewKey[];
  serverData?: IViewVo[];
  children: React.ReactNode;
}

export const ViewProxy = (props: IViewProxyProps) => {
  const { proxyKeys, serverData, children } = props;
  const view = useView();
  const [proxyView, setProxyView] = useState<IViewInstance>();
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
    if (!viewData) return;
    const newViewProxy = createViewInstance(viewData);
    newViewProxy.submitOperation = async (operation: IOtOperation) => {
      const { oi, od, p } = operation;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const path = p[0] as any;
      const hasFilter = !proxyKeys || proxyKeys.includes(path);
      if ((oi || od) && hasFilter) {
        const newViewData = { ...viewData };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newViewData as any)[path] = oi ?? null;
        setViewData(newViewData);
        return oi;
      }
      if (!viewSubmitOperation.current) {
        return;
      }
      return await viewSubmitOperation.current(operation);
    };
    setProxyView(newViewProxy);
    return () => (viewSubmitOperation.current = undefined);
  }, [viewData, proxyKeys]);

  return (
    <ViewContext.Provider value={{ views: proxyView ? [proxyView] : [] }}>
      {children}
    </ViewContext.Provider>
  );
};
