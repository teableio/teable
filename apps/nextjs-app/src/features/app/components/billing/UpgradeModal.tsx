import { useBillingUpgradeStore } from '@teable/sdk/components/billing/store';
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

export const UpgradeModal = () => {
  const base = useBase();
  const router = useRouter();
  const { t } = useTranslation('common');
  const { modalOpen, toggleUpgradeModal } = useBillingUpgradeStore();

  if (base == null) return null;

  const { spaceId } = base;

  const onClick = () => {
    router.push({
      pathname: '/space/[spaceId]/setting/plan',
      query: { spaceId },
    });
    toggleUpgradeModal(false);
  };

  return (
    <Dialog open={modalOpen} onOpenChange={toggleUpgradeModal}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('billing.overLimits')}</DialogTitle>
          <DialogDescription className="pt-1">
            {t('billing.overLimitsDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="sm" onClick={onClick}>
            {t('actions.upgrade')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
