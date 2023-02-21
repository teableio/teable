import { View } from '../../model/view';
import { IViewSnapshot, SnapshotQueryType } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import { FC, ReactNode, useContext, useEffect, useState } from 'react';
import { AppContext } from '../app';
import { TableContext } from '../table';
import { ViewContext } from './ViewContext';

interface IViewProviderProps {
  fallback: ReactNode;
  children: ReactNode;
}

export const ViewProvider: FC<IViewProviderProps> = ({ children, fallback }) => {
  const { connection } = useContext(AppContext);
  const { tableId } = useContext(TableContext);
  const [views, setViews] = useState<View[]>([]);

  useEffect(() => {
    if (!tableId) {
      return;
    }
    const viewsQuery = connection.createSubscribeQuery<IViewSnapshot>(tableId, {
      type: SnapshotQueryType.View,
    });

    viewsQuery.on('ready', () => {
      console.log('view:ready:', viewsQuery.results);
      setViews(viewsQuery.results.map((r) => plainToInstance(View, r.data.view)));
    });

    viewsQuery.on('changed', () => {
      console.log('view:changed:', viewsQuery.results);
      setViews(viewsQuery.results.map((r) => plainToInstance(View, r.data.view)));
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
