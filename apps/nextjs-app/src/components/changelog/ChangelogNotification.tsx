import { ArrowUpRight, X } from '@teable/icons';
import { LocalStorageKeys } from '@teable/sdk/config';
import { useIsHydrated } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { Rocket } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useState } from 'react';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';

export const ChangelogNotification = () => {
  const { t } = useTranslation('common');
  const isHydrated = useIsHydrated();
  const isCloud = useIsCloud();
  const [visible, setVisible] = useState(false);

  const changelogId = t('changelog.id');
  const title = t('changelog.title');
  const url = t('changelog.url');

  useEffect(() => {
    if (!changelogId) return;
    try {
      const dismissedId = localStorage.getItem(LocalStorageKeys.DismissedChangelog);
      if (dismissedId !== changelogId) {
        setVisible(true);
      }
    } catch {
      // ignore
    }
  }, [changelogId, title]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(LocalStorageKeys.DismissedChangelog, changelogId);
    } catch {
      // ignore
    }
  }, [changelogId]);

  if (!isCloud || !isHydrated || !visible) {
    return null;
  }

  return (
    <div className="flex w-full shrink-0 flex-col items-center gap-2 !border-0 px-4">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative flex w-full items-center justify-between rounded-md bg-surface px-4 py-3 transition-colors hover:bg-accent dark:hover:bg-white/10"
      >
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1 pr-6">
          <span className="flex w-full items-center gap-1.5 truncate text-left text-xs font-semibold uppercase text-muted-foreground">
            <Rocket className="size-3" />
            <span>{t('changelog.newUpdate')}</span>
          </span>
          <div className="flex w-full min-w-0 items-center gap-1">
            <span className="min-w-0 truncate text-left font-medium text-primary" title={title}>
              {title}
            </span>
            <ArrowUpRight className="size-4 shrink-0 rounded-sm border border-primary stroke-2 text-primary" />
          </div>
        </div>

        {/* Close Button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 size-5 p-0 text-muted-foreground hover:bg-transparent"
          aria-label="Close"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDismiss();
          }}
        >
          <X className="size-4" />
        </Button>
      </a>
    </div>
  );
};
