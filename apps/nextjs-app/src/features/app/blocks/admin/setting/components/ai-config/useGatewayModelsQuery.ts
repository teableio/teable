import { useQuery } from '@tanstack/react-query';
import { getAiProxyGatewayModels } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useMemo } from 'react';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { useIsEE } from '@/features/app/hooks/useIsEE';

// The catalog changes at most hourly server-side, so keep dialog reopens from
// refetching the full pricing payload.
const GATEWAY_MODELS_STALE_TIME = 5 * 60 * 1000;

/**
 * Shared query for the AI proxy gateway model list ({ configured, models }).
 * All gateway model consumers go through this hook so they share one cache
 * entry and a single request. The endpoint only exists on the enterprise
 * backend, so the community edition never sends the request.
 */
export function useGatewayModelsQuery(options?: { enabled?: boolean }) {
  const isEE = useIsEE();
  const isCloud = useIsCloud();

  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ReactQueryKeys.getGatewayModels(),
    queryFn: () => getAiProxyGatewayModels().then(({ data }) => data),
    enabled: (isEE || isCloud) && (options?.enabled ?? true),
    staleTime: GATEWAY_MODELS_STALE_TIME,
  });

  const models = useMemo(() => data?.models ?? [], [data]);
  const errorMessage = error instanceof Error ? error.message : null;

  return { data, models, errorMessage, isLoading, isFetching, refetch };
}
