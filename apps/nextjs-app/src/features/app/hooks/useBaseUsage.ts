import { useQuery } from '@tanstack/react-query';
import { getBaseUsage } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { useIsCloud } from './useIsCloud';
import { useIsEE } from './useIsEE';

export const useBaseUsage = () => {
  const isEE = useIsEE();
  const isCloud = useIsCloud();
  const baseId = useBaseId() as string;

  const { data: baseUsage } = useQuery({
    queryKey: ['base-usage', baseId],
    queryFn: ({ queryKey }) => getBaseUsage(queryKey[1]).then(({ data }) => data),
    enabled: isCloud || isEE,
  });

  return baseUsage;
};
