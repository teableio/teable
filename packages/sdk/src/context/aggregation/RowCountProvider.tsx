import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRowCount } from '@teable-group/openapi';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ReactQueryKeys } from '../../config/react-query-keys';
import { useIsHydrated, useActionTrigger } from '../../hooks';
import { AnchorContext } from '../anchor';
import { RowCountContext } from './RowCountContext';

interface IRowCountProviderProps {
  children: ReactNode;
}

export const RowCountProvider: FC<IRowCountProviderProps> = ({ children }) => {
  const actionTrigger = useActionTrigger();
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const queryClient = useQueryClient();

  const { data: resRowCount } = useQuery({
    queryKey: ReactQueryKeys.rowCount(tableId as string, { viewId }),
    queryFn: ({ queryKey }) => getRowCount(queryKey[1], queryKey[2]),
    enabled: !!tableId && isHydrated,
    refetchOnWindowFocus: false,
  });

  const updateRowCount = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.rowCount(tableId as string, { viewId })),
    [queryClient, tableId, viewId]
  );

  useEffect(() => {
    if (tableId == null) return;

    if ([tableId, viewId].some((value) => value && actionTrigger?.fetchRowCount?.includes(value))) {
      updateRowCount();
    }
  }, [actionTrigger?.fetchRowCount, tableId, updateRowCount, viewId]);

  const rowCount = useMemo(() => {
    if (!resRowCount) return 0;

    const { rowCount } = resRowCount.data;
    return rowCount;
  }, [resRowCount]);
  return <RowCountContext.Provider value={rowCount}>{children}</RowCountContext.Provider>;
};
