import type { IViewSnapshot, IViewVo } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useMemo, useState } from 'react';
import { createViewInstance } from '../../model/view/factory';
import type { View } from '../../model/view/view';
import { AppContext } from '../app';
import { TableContext } from '../table';
import { ViewContext } from './ViewContext';

interface IViewProviderProps {
  fallback: ReactNode;
  serverData?: IViewVo[];
  children: ReactNode;
}

export const ViewProvider: FC<IViewProviderProps> = ({ children, fallback, serverData }) => {
  const { connection } = useContext(AppContext);
  const { tableId } = useContext(TableContext);
  const [views, setViews] = useState<View[]>(() => {
    if (serverData) {
      return serverData.map((view) => createViewInstance(view));
    }
    return [];
  });

  useEffect(() => {
    if (!tableId || !connection) {
      return;
    }
    const viewsQuery = connection.createSubscribeQuery<IViewSnapshot>(
      `${IdPrefix.View}_${tableId}`,
      {}
    );

    viewsQuery.on('ready', () => {
      console.log('view:ready:', viewsQuery.results);
      setViews(viewsQuery.results.map((r) => createViewInstance(r.data.view, r)));
    });

    viewsQuery.on('changed', () => {
      console.log('view:changed:', viewsQuery.results);
      setViews(viewsQuery.results.map((r) => createViewInstance(r.data.view, r)));
    });

    return () => {
      viewsQuery.destroy();
    };
  }, [connection, tableId]);

  const value = useMemo(() => {
    return { views };
  }, [views]);

  if (fallback && !views.length) {
    return <>{fallback}</>;
  }

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
};
