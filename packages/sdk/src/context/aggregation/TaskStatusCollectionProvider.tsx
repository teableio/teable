import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ITableActionKey } from '@teable/core';
import { getTaskStatusCollection } from '@teable/openapi';
import { throttle } from 'lodash';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useIsHydrated, useTableListener } from '../../hooks';
import { AnchorContext } from '../anchor';
import { TaskStatusCollectionContext } from './TaskStatusCollectionContext';

const THROTTLE_TIME_MS = 2000;

interface ITaskStatusCollectionProviderProps {
  children: ReactNode;
}

export const TaskStatusCollectionProvider: FC<ITaskStatusCollectionProviderProps> = ({
  children,
}) => {
  const isHydrated = useIsHydrated();
  const { tableId } = useContext(AnchorContext);
  const queryClient = useQueryClient();

  const { data: resTaskStatusCollection } = useQuery({
    queryKey: ReactQueryKeys.getTaskStatusCollection(tableId as string),
    queryFn: ({ queryKey }) => getTaskStatusCollection(queryKey[1]).then((data) => data.data),
    enabled: Boolean(tableId && isHydrated),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const updateTaskStatusCollectionForTable = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ReactQueryKeys.getTaskStatusCollection(tableId as string),
    });
  }, [queryClient, tableId]);

  const throttleUpdateTaskStatusCollectionForTable = useMemo(
    () => throttle(updateTaskStatusCollectionForTable, THROTTLE_TIME_MS),
    [updateTaskStatusCollectionForTable]
  );

  const tableMatches = useMemo<ITableActionKey[]>(
    () => ['taskProcessing', 'taskCompleted', 'taskCancelled', 'taskFailed'],
    []
  );
  useTableListener(tableId, tableMatches, throttleUpdateTaskStatusCollectionForTable);

  const taskStatusCollection = useMemo(
    () => resTaskStatusCollection || null,
    [resTaskStatusCollection]
  );

  return (
    <TaskStatusCollectionContext.Provider value={taskStatusCollection}>
      {children}
    </TaskStatusCollectionContext.Provider>
  );
};
