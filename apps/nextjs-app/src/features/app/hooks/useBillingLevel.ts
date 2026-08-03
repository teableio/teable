import { useQuery } from '@tanstack/react-query';
import { getInstanceUsage, getSubscriptionSummary } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseUsage } from './useBaseUsage';
import { useIsCloud } from './useIsCloud';
import { useIsEE } from './useIsEE';

export const useBillingLevel = ({ spaceId, baseId }: { spaceId?: string; baseId?: string }) => {
  const isCloud = useIsCloud();
  const isEE = useIsEE();

  const baseUsage = useBaseUsage({ disabled: !baseId });

  const { data: instanceUsage } = useQuery({
    queryKey: ReactQueryKeys.instanceUsage(),
    queryFn: () => getInstanceUsage().then((res) => res.data),
    enabled: isEE && Boolean(spaceId),
  });

  const { data: subscriptionSummary } = useQuery({
    queryKey: ReactQueryKeys.subscriptionSummary(spaceId as string),
    queryFn: () => getSubscriptionSummary(spaceId as string).then((res) => res.data),
    enabled: isCloud && Boolean(spaceId),
  });

  return subscriptionSummary?.level ?? baseUsage?.level ?? instanceUsage?.level;
};
