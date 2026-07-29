import type { IViewVo } from '@teable/core';
import { IdPrefix } from '@teable/core';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import type { Doc } from 'sharedb/lib/client';
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

  const factory = useCallback(
    (view: IViewVo, doc?: Doc<IViewVo>) => {
      const instance = createViewInstance(view, doc);
      if (!doc && tableId) {
        // doc-less (seeded) instance: the factory derives tableId from the
        // doc collection, so inject it here to keep view mutations working
        instance.tableId = tableId;
      }
      return instance;
    },
    [tableId]
  );

  const { instances: views } = useInstances({
    collection: `${IdPrefix.View}_${tableId}`,
    factory,
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
