import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { isBillableRole, type IRole } from '@teable/core';
import type { ISubscriptionSummaryVo } from '@teable/openapi';
import { BillingProductLevel, getInstanceUsage, getSubscriptionSummary } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useConfirm } from '@teable/ui-lib/base/dialog/confirm-modal';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { useBillingLevel } from './useBillingLevel';
import { useIsCloud } from './useIsCloud';
import { useIsEE } from './useIsEE';

type ISeatConfirmAction = 'invite' | 'link' | 'roleChange' | 'matrix';

interface ISeatConfirmOptions {
  count: number;
  action: ISeatConfirmAction;
  // omitted role means the seat is billable regardless of role (authority matrix)
  role?: IRole;
}

// Whether a space is fixed-seat cannot change mid-session, so a cached
// summary saying "not fixed-seat" is final and skips the network round trip
// (useBillingLevel keeps the cache warm). Only fixed-seat spaces refetch at
// decision time — the over-cap warning must not act on stale usage counts.
const fetchSubscriptionSummary = (queryClient: QueryClient, spaceId: string) => {
  const cached = queryClient.getQueryData<ISubscriptionSummaryVo>(
    ReactQueryKeys.subscriptionSummary(spaceId)
  );
  if (cached && cached.fixedSeatQuantity == null) return cached;
  return queryClient
    .fetchQuery({
      queryKey: ReactQueryKeys.subscriptionSummary(spaceId),
      queryFn: () => getSubscriptionSummary(spaceId).then((res) => res.data),
      staleTime: 0,
    })
    .catch(() => undefined);
};

// Fixed-seat (AppSumo/manual) subscriptions bypass the backend 460 guard:
// exceeding their cap silently degrades the space after a grace period, so
// the caller warns upfront. Returns the cap snapshot when the addition goes
// over it, null when it fits (nothing is billed, no confirmation needed) and
// undefined when the space is not fixed-seat (Stripe-billed, hard-limited
// server-side).
const getFixedSeatOverCap = async (
  queryClient: QueryClient,
  spaceId: string | undefined,
  count: number
) => {
  const summary = spaceId ? await fetchSubscriptionSummary(queryClient, spaceId) : undefined;
  if (summary?.fixedSeatQuantity == null) return undefined;
  const seats = summary.fixedSeatUsage ?? 0;
  return seats + count > summary.fixedSeatQuantity
    ? { quantity: summary.fixedSeatQuantity, seats }
    : null;
};

// Resolves true when the action does not need a billing confirmation,
// otherwise reflects the user's choice in the confirm dialog.
// Self-host over-limit is a hard stop: the dialog informs and always resolves false.
export const useSeatConfirm = ({ spaceId, baseId }: { spaceId?: string; baseId?: string }) => {
  const { t } = useTranslation('common');
  const isCloud = useIsCloud();
  const isEE = useIsEE();
  const level = useBillingLevel({ spaceId, baseId });
  const { confirm, alert } = useConfirm();
  const queryClient = useQueryClient();

  const isPaidSpace = isCloud && level != null && level !== BillingProductLevel.Free;

  return useCallback(
    async ({ role, count, action }: ISeatConfirmOptions) => {
      if (count <= 0 || (role != null && !isBillableRole(role))) {
        return true;
      }

      if (isPaidSpace) {
        const overCap = await getFixedSeatOverCap(queryClient, spaceId, count);
        if (overCap) {
          return confirm({
            title: t('billing.seatConfirm.fixedSeatTitle'),
            description: t('billing.seatConfirm.fixedSeatDesc', overCap),
            confirmText: t('actions.confirm'),
            cancelText: t('actions.cancel'),
          });
        }
        if (overCap === null) return true;

        // Stripe-billed model: billable additions within the purchased seats
        // cost nothing extra, and exceeding them is hard-blocked by the
        // backend (HTTP 460 opens the seat-purchase modal) — no upfront
        // confirmation needed. The authority-matrix path is exempt from the
        // backend guard and still auto-bills, so only it keeps a warning.
        if (action !== 'matrix') return true;
        return confirm({
          title: t('billing.seatConfirm.matrixTitle'),
          description: t('billing.seatConfirm.matrixDesc', { count }),
          confirmText: t('actions.confirm'),
          cancelText: t('actions.cancel'),
        });
      }

      if (isEE) {
        // fetched at decision time: the hard seat-limit gate must not act on stale counts
        const instanceUsage = await queryClient
          .fetchQuery({
            queryKey: ReactQueryKeys.instanceUsage(),
            queryFn: () => getInstanceUsage().then((res) => res.data),
            staleTime: 0,
          })
          .catch(() => undefined);
        const seats = instanceUsage?.seats ?? 0;
        const seatLimit = instanceUsage?.seatLimit;
        if (seatLimit != null && seats + count > seatLimit) {
          await alert({
            title: t('billing.seatConfirm.seatLimitTitle'),
            description: t('billing.seatConfirm.seatLimitDesc', { seats, seatLimit }),
            confirmText: t('billing.seatConfirm.seatLimitConfirm'),
          });
          return false;
        }
      }

      return true;
    },
    [isPaidSpace, spaceId, isEE, confirm, alert, queryClient, t]
  );
};
