import { useQuery } from '@tanstack/react-query';
import { getBaseUsage } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { useIsReadOnlyPreview } from '@teable/sdk/hooks/use-is-readonly-preview';
import { useIsCloud } from './useIsCloud';
import { useIsEE } from './useIsEE';

export const useBaseUsage = (props?: { disabled?: boolean }) => {
  const isEE = useIsEE();
  const isCloud = useIsCloud();
  const baseId = useBaseId() as string;
  const isReadOnlyPreview = useIsReadOnlyPreview();

  const { data: baseUsage } = useQuery({
    queryKey: ['base-usage', baseId],
    queryFn: ({ queryKey }) => getBaseUsage(queryKey[1]).then(({ data }) => data),
    enabled: !props?.disabled && (isCloud || isEE) && !isReadOnlyPreview,
  });

  return baseUsage;
};

export const useBaseUsageWithLoading = (props?: { disabled?: boolean }) => {
  const isEE = useIsEE();
  const isCloud = useIsCloud();
  const baseId = useBaseId() as string;

  const {
    data: baseUsage,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ['base-usage', baseId],
    queryFn: ({ queryKey }) => getBaseUsage(queryKey[1]).then(({ data }) => data),
    enabled: !props?.disabled && (isCloud || isEE),
  });

  return { baseUsage, loading: isLoading, isFetched };
};
