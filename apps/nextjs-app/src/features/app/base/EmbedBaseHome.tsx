import { useTranslation } from 'next-i18next';
import { usePrefetchBaseEntry } from '../hooks/usePrefetchBaseEntry';

/**
 * Base home (`/base/{baseId}`) inside the native mobile shell. On desktop the
 * page redirects to the last visited / first node; in embed mode the app's own
 * directory tree page owns that choice, so this only says where to look.
 */
export const EmbedBaseHome = () => {
  const { t } = useTranslation('common');
  // The native shell boots on this page and opens tables by routing inside it: warm the
  // client-only Table chunk here, the way the space page does on desktop.
  usePrefetchBaseEntry();
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-base font-medium text-foreground">{t('mobileEmbed.pickFromDirectory')}</p>
      <p className="text-sm text-muted-foreground">{t('mobileEmbed.pickFromDirectoryHint')}</p>
    </div>
  );
};
