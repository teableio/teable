import type { QueryFunction, QueryKey, UseQueryOptions } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';

interface IShareAwareBranch<TData> {
  queryKey: QueryKey;
  queryFn: QueryFunction<TData, QueryKey>;
}

interface IShareAwareQueryParams<TData> {
  shareId: string | undefined;
  enabled: boolean;
  common: IShareAwareBranch<TData>;
  share: IShareAwareBranch<TData>;
  options?: Pick<UseQueryOptions<TData, Error, TData, QueryKey>, 'retry' | 'placeholderData'>;
}

/**
 * Common and share queries hit different endpoints under different cache keys.
 * Run both (the inactive branch stays disabled) and surface the active result
 * plus its key, so the dual-endpoint plumbing lives in one place instead of
 * being hand-mirrored in every aggregation provider.
 */
export const useShareAwareQuery = <TData>({
  shareId,
  enabled,
  common,
  share,
  options,
}: IShareAwareQueryParams<TData>): { data: TData | undefined; activeQueryKey: QueryKey } => {
  const isShare = Boolean(shareId);

  const { data: commonData } = useQuery({
    queryKey: common.queryKey,
    queryFn: common.queryFn,
    enabled: !isShare && enabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    ...options,
  });

  const { data: shareData } = useQuery({
    queryKey: share.queryKey,
    queryFn: share.queryFn,
    enabled: isShare && enabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    ...options,
  });

  return {
    data: isShare ? shareData : commonData,
    activeQueryKey: isShare ? share.queryKey : common.queryKey,
  };
};
