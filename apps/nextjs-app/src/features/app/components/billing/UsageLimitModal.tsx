import { UsageLimitModalType, useUsageLimitModalStore } from '@teable/sdk/components/billing/store';
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

export const UsageLimitModal = () => {
  const base = useBase();
  const router = useRouter();
  const { t } = useTranslation('common');
  const { modalType, modalOpen, toggleModal } = useUsageLimitModalStore();
  const isUpgrade = modalType === UsageLimitModalType.Upgrade;

  const description = useMemo(() => {
    if (!isUpgrade) {
      return t('billing.userLimitExceededDescription');
    }
    return t('billing.overLimitsDescription');
  }, [isUpgrade, t]);

  if (base == null) return null;

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
