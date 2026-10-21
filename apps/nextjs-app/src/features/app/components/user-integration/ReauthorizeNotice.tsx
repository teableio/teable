import { Button, cn } from '@teable/ui-lib/shadcn';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'next-i18next';

/**
 * The account's stored grant no longer works (the provider refused to refresh it: the
 * user revoked it, or it expired). Nothing server-side can mint a new one — only the
 * user, through the provider's consent screen — so this says so in place and offers
 * that one step, instead of dropping the whole flow back to "connect an account".
 */
export const ReauthorizeNotice = ({
  onReauthorize,
  busy,
  className,
}: {
  onReauthorize: () => void;
  busy?: boolean;
  className?: string;
}) => {
  const { t } = useTranslation('common');
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs',
        className
      )}
    >
      <AlertTriangle className="size-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 basis-48">{t('import.accountNeedsReauth')}</span>
      <Button size="xs" variant="outline" disabled={busy} onClick={onReauthorize}>
        {t('import.reauthorize')}
      </Button>
    </div>
  );
};
