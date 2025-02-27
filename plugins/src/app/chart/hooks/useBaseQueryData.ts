import { useQuery } from '@tanstack/react-query';
import { type CellFormat } from '@teable/core';
import { useContext } from 'react';
import { useEnv } from '../../../hooks/useEnv';
import { ChartContext } from '../components/ChartProvider';
import { baseQueryKeys, getBaseQueryData } from '../query';

export const useBaseQueryData = (cellFormat?: CellFormat) => {
  const { baseId, pluginId } = useEnv();
  const { storage, onQueryError } = useContext(ChartContext);
  const query = storage?.query;

  const { data } = useQuery({
    queryKey: baseQueryKeys(baseId, query!, cellFormat),
    enabled: !!query || Boolean(pluginId),
    queryFn: async ({ queryKey }) => {
      return getBaseQueryData({
        pluginId,
        queryKeys: queryKey,
        onQueryError,
      });
    },
  });

  return data;
};
