import { useQuery } from '@tanstack/react-query';
import { baseEntryMapDefaultTake, getBaseEntryMap } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

/**
 * Prefetch, while the user is still browsing a space's base list, the entry
 * URL each base resolves to — so a card click can navigate straight to the
 * final /base/{id}/table/{tableId}/{viewId} (a single SSR round) instead of
 * paying the /base/{id} redirect chain.
 *
 * Pull-only: useEnterBase reads the cached map at click time; the map's
 * arrival never triggers anything by itself. Bases missing from the map fall
 * back to the redirect chain, and a stale entry self-heals through the table
 * route's existing fallbacks — worst case is one extra redirect, same as
 * today. Never on any critical path.
 */
export const useBaseEntryMap = (spaceId?: string) => {
  useQuery({
    queryKey: ReactQueryKeys.baseEntryMap(spaceId as string),
    queryFn: () =>
      getBaseEntryMap({ spaceId: spaceId as string, take: baseEntryMapDefaultTake }).then(
        (res) => res.data
      ),
    enabled: Boolean(spaceId),
    // refetch whenever the list is shown again so the map reflects visits
    // made on other devices/tabs since the last look
    staleTime: 0,
    refetchOnWindowFocus: true,
    // purely additive optimization: any failure must stay invisible — no
    // global error toast, no retries, clicks just keep the redirect chain
    retry: false,
    meta: { preventGlobalError: true },
  });
};
