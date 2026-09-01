import { useQueryClient } from '@tanstack/react-query';
import { isBillableRole, type IRole } from '@teable/core';
import { BillingProductLevel, getInstanceUsage } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useConfirm } from '@teable/ui-lib/base/dialog/confirm-modal';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { useRoleStatic } from '../components/collaborator-manage/useRoleStatic';
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

const SEAT_CONFIRM_COPY = {
  invite: { titleKey: 'billing.seatConfirm.title', descKey: 'billing.seatConfirm.inviteDesc' },
  link: { titleKey: 'billing.seatConfirm.title', descKey: 'billing.seatConfirm.linkDesc' },
  roleChange: {
    titleKey: 'billing.seatConfirm.roleChangeTitle',
    descKey: 'billing.seatConfirm.roleChangeDesc',
  },
  matrix: {
    titleKey: 'billing.seatConfirm.matrixTitle',
    descKey: 'billing.seatConfirm.matrixDesc',
  },
} as const;

// Resolves true when the action does not need a billing confirmation,
// otherwise reflects the user's choice in the confirm dialog.
// Self-host over-limit is a hard stop: the dialog informs and always resolves false.
export const useSeatConfirm = ({ spaceId, baseId }: { spaceId?: string; baseId?: string }) => {
  const { t } = useTranslation('common');
  const isCloud = useIsCloud();
  const isEE = useIsEE();
  const level = useBillingLevel({ spaceId, baseId });
  const roleStatic = useRoleStatic();
  const { confirm, alert } = useConfirm();
  const queryClient = useQueryClient();

  const isPaidSpace = isCloud && level != null && level !== BillingProductLevel.Free;

  return useCallback(
    async ({ role, count, action }: ISeatConfirmOptions) => {
      if (count <= 0 || (role != null && !isBillableRole(role))) {
        return true;
      }

      if (isPaidSpace) {
        const roleName = roleStatic.find((item) => item.role === role)?.name;
        const copy = SEAT_CONFIRM_COPY[action];
        return confirm({
          title: t(copy.titleKey),
          description: t(copy.descKey, { count, role: roleName }),
          confirmText:
            action === 'invite' ? t('billing.seatConfirm.confirmInvite') : t('actions.confirm'),
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
    [isPaidSpace, isEE, confirm, alert, queryClient, roleStatic, t]
  );
};
