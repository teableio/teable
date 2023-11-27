import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IViewRowCountRo } from '@teable-group/core';
import { getShareViewRowCount } from '@teable-group/openapi';
import { useConnectionRowCount } from '@teable-group/sdk/context';
import { RowCountContext } from '@teable-group/sdk/context/aggregation/RowCountContext';
import { useView } from '@teable-group/sdk/hooks';
import type { ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import { ShareViewPageContext } from '../../../ShareViewPageContext';

interface IRowCountProviderProps {
  children: ReactNode;
}

const useRowCountQuery = (): IViewRowCountRo => {
  const view = useView();
  return useMemo(() => ({ filter: view?.filter }), [view?.filter]);
};

export const RowCountProvider = ({ children }: IRowCountProviderProps) => {
  const { shareId } = useContext(ShareViewPageContext);
  const queryClient = useQueryClient();
  const viewRowCountQuery = useRowCountQuery();
  const { data: shareViewRowCount } = useQuery({
    queryKey: ['shareRowCount', shareId, viewRowCountQuery],
    queryFn: ({ queryKey }) =>
      getShareViewRowCount(queryKey[1] as string, queryKey[2] as IViewRowCountRo),
    refetchOnWindowFocus: false,
  });

  const updateViewRowCount = useCallback(
    () => queryClient.invalidateQueries(['shareRowCount', shareId, viewRowCountQuery]),
    [queryClient, shareId, viewRowCountQuery]
  );
  useConnectionRowCount(updateViewRowCount);

  const rowCount = useMemo(() => {
    if (!shareViewRowCount) {
      return null;
    }
    return shareViewRowCount.data.rowCount;
  }, [shareViewRowCount]);

  return <RowCountContext.Provider value={rowCount}>{children}</RowCountContext.Provider>;
};
