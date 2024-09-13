import type { IViewVo } from '@teable/core';
import { IdPrefix } from '@teable/core';
import type { FC, ReactNode } from 'react';
import { useContext, useMemo } from 'react';
import { createViewInstance } from '../../model/view/factory';
import { AnchorContext } from '../anchor';
import { useInstances } from '../use-instances';
import { ViewContext } from './ViewContext';

interface IViewProviderProps {
  fallback?: ReactNode;
  serverData?: IViewVo[];
  children: ReactNode;
}

export const ViewProvider: FC<IViewProviderProps> = ({ children, fallback, serverData }) => {
  const { tableId } = useContext(AnchorContext);
  const { instances: views } = useInstances({
    collection: `${IdPrefix.View}_${tableId}`,
    factory: createViewInstance,
    initData: serverData,
    queryParams: {},
  });

  const value = useMemo(() => {
    return { views };
  }, [views]);

  if (fallback && !views.length) {
    return <>{fallback}</>;
  }

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
};
