import { useQuery } from '@tanstack/react-query';
import { type CellFormat } from '@teable/core';
import { useSession } from '@teable/sdk';
import { useContext } from 'react';
import { useEnv } from '../../../hooks/useEnv';
import { ChartContext } from '../components/ChartProvider';
import { baseQueryKeys, getBaseQueryData } from '../query';

export const useBaseQueryData = (cellFormat?: CellFormat) => {
  const { baseId, pluginId } = useEnv();
  const { storage, onQueryError } = useContext(ChartContext);
  const query = storage?.query;
  const { user } = useSession();
  const currentUserId = user?.id;
  const { data } = useQuery({
    queryKey: baseQueryKeys(baseId, query!, cellFormat),
    enabled: !!query && Boolean(pluginId) && Boolean(currentUserId),
    queryFn: async ({ queryKey }) => {
      return getBaseQueryData({
        pluginId,
        queryKeys: queryKey,
        onQueryError,
        options: {
          currentUserId,
        },
      });
    },
  });

  return data;
};
