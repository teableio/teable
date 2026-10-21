import { X } from '@teable/icons';
import { useIsHydrated, useIsMobile } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useIsInIframe } from '../../hooks/useIsInIframe';

type MobileShareOperation = 'edit' | 'save';

interface IMobileShareOperationBarProps {
  operation: MobileShareOperation;
  onAction: () => void;
}

export const MobileShareOperationBar = ({ operation, onAction }: IMobileShareOperationBarProps) => {
  const { t } = useTranslation(['common', 'table', 'auth']);
  const isHydrated = useIsHydrated();
  const isMobile = useIsMobile();
  const isInIframe = useIsInIframe();
  const [dismissed, setDismissed] = useState(false);

  if (!isHydrated || !isMobile || isInIframe || dismissed) {
    return null;
  }

  const isEdit = operation === 'edit';
  const message = isEdit
    ? t('table:baseShare.editRequiresLogin')
    : t('table:baseShare.supportSaveCopy');
  const actionLabel = isEdit
    ? `${t('auth:button.signin')}/${t('auth:button.signup')}`
    : t('common:actions.save');

  return (
    <div
      className="fixed inset-x-4 z-40 mx-auto flex min-h-11 max-w-[480px] items-center gap-2 rounded-lg border bg-popover py-2 pe-3 ps-4 shadow-lg"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 3.5rem)' }}
    >
      <p className="min-w-0 flex-1 text-sm text-foreground">{message}</p>
      <Button
        type="button"
        size="xs"
        className="h-7 shrink-0 px-2 text-xs font-normal"
        onClick={onAction}
      >
        {actionLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-7 shrink-0 text-muted-foreground"
        aria-label={t('common:actions.close')}
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
};
