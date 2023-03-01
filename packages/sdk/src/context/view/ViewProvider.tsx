import { View } from '../../model/view/view';
import { IViewSnapshot, IViewVo, SnapshotQueryType } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import { FC, ReactNode, useContext, useEffect, useState } from 'react';
import { AppContext } from '../app';
import { TableContext } from '../table';
import { ViewContext } from './ViewContext';
import { createViewInstance } from '../../model/view/factory';

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
    if (!tableId) {
      return;
    }
    const viewsQuery = connection.createSubscribeQuery<IViewSnapshot>(tableId, {
      type: SnapshotQueryType.View,
    });

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

  if (fallback && !views.length) {
    return <>{fallback}</>;
  }

  return (
    <ViewContext.Provider
      value={{
        views,
      }}
    >
      {children}
    </ViewContext.Provider>
  );
};
