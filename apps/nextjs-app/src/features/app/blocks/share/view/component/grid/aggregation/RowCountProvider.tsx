import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IShareViewRowCountRo } from '@teable-group/openapi';
import { getShareViewRowCount } from '@teable-group/openapi';
import type { PropKeys } from '@teable-group/sdk';
import { RowCountContext, ReactQueryKeys, useActionTrigger } from '@teable-group/sdk';
import { useView } from '@teable-group/sdk/hooks';
import type { ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import { ShareViewPageContext } from '../../../ShareViewPageContext';

interface IRowCountProviderProps {
  children: ReactNode;
}

const useRowCountQuery = (): IShareViewRowCountRo => {
  const view = useView();
  return useMemo(() => ({ filter: view?.filter }), [view?.filter]);
};

export const RowCountProvider = ({ children }: IRowCountProviderProps) => {
  const { tableId, viewId, shareId } = useContext(ShareViewPageContext);
  const { listener } = useActionTrigger();
  const queryClient = useQueryClient();
  const query = useRowCountQuery();

  const { data: shareViewRowCount } = useQuery({
    queryKey: ReactQueryKeys.shareViewRowCount(shareId, query),
    queryFn: ({ queryKey }) => getShareViewRowCount(queryKey[1], queryKey[2]),
    refetchOnWindowFocus: false,
  });

  const updateViewRowCount = useCallback(
    () => queryClient.invalidateQueries(ReactQueryKeys.shareViewRowCount(shareId, query)),
    [query, queryClient, shareId]
  );

  useEffect(() => {
    const relevantProps = [
      'tableUpdate',
      'tableAdd',
      'tableDelete',
      'applyViewFilter',
    ] as PropKeys[];

    listener?.(relevantProps, () => updateViewRowCount(), [tableId, viewId]);
  }, [listener, tableId, updateViewRowCount, viewId]);

  const rowCount = useMemo(() => {
    if (!shareViewRowCount) {
      return null;
    }
    return shareViewRowCount.data.rowCount;
  }, [shareViewRowCount]);

  return <RowCountContext.Provider value={rowCount}>{children}</RowCountContext.Provider>;
};
