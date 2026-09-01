import { useQuery } from '@tanstack/react-query';
import { getPinEntryMap } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

/**
 * Prefetch, while the pin list is on screen, the entry URL each pinned
 * base/table resolves to — so a pin click can navigate straight to the final
 * /base/{id}/table/{tableId}/{viewId} instead of paying the redirect chain.
 *
 * Pull-only and fully independent of the pin list request: pins missing from
 * the map keep today's navigation, a stale entry self-heals through the table
 * route's existing fallbacks, and any failure stays invisible.
 */
export const usePinEntryMap = () => {
  return useQuery({
    queryKey: ReactQueryKeys.pinEntryMap(),
    queryFn: () => getPinEntryMap().then((res) => res.data),
    // refetch whenever the list is shown again so the map reflects the
    // latest visits
    staleTime: 0,
    refetchOnWindowFocus: true,
    // purely additive optimization: no global error toast, no retries
    retry: false,
    meta: { preventGlobalError: true },
  });
};
