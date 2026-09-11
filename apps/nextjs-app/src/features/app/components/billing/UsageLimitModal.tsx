import { Role } from '@teable/core';
import { UsageLimitModalType, useUsageLimitModalStore } from '@teable/sdk/components/billing/store';
import { UsageLimitReasonBlock } from '@teable/sdk/components/billing/UsageLimitReasonBlock';
import { useBase } from '@teable/sdk/hooks';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useUpgradeCtaEnabled } from '../../hooks/useUpgradeCtaEnabled';
import { UsageLimitConstraintDialog } from './UsageLimitConstraintDialog';

export const UsageLimitModal = () => {
  const base = useBase();
  const router = useRouter();
  const { t } = useTranslation('common');
  const { modalType, modalOpen, toggleModal } = useUsageLimitModalStore();
  const isUpgrade = modalType === UsageLimitModalType.Upgrade;
  const upgradeCtaEnabled = useUpgradeCtaEnabled();

  const description = useMemo(() => {
    if (!isUpgrade) {
      return t('billing.userLimitExceededDescription');
    }
    return t('billing.overLimitsDescription');
  }, [isUpgrade, t]);

  if (base == null) return null;

  // Native mobile WebView: state the limit, never the paywall (App Store 3.1.3).
  if (!upgradeCtaEnabled) {
    return (
      <UsageLimitConstraintDialog
        open={modalOpen}
        onOpenChange={toggleModal}
        modalType={modalType}
        isSpaceOwner={base.role === Role.Owner}
      />
    );
  }

  const { spaceId } = base;

  const onClick = () => {
    if (isUpgrade) {
      router.push({
        pathname: '/space/[spaceId]/setting/plan',
        query: { spaceId },
      });
    } else {
      router.push('/admin/user');
    }
    toggleModal(false);
  };

  return (
    <Dialog open={modalOpen} onOpenChange={toggleModal}>
      <DialogContent
        className="sm:max-w-[425px]"
        closeable={isUpgrade}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('billing.overLimits')}</DialogTitle>
          {isUpgrade && <UsageLimitReasonBlock />}
          <DialogDescription className="pt-1">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="sm" onClick={onClick}>
            {isUpgrade ? t('actions.upgrade') : t('actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
