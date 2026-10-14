import { allConsent } from '@teable/core';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { closeCookieSettings, saveConsent, useMarketingConsent } from '@/lib/marketing-consent';

const COOKIE_POLICY_URL = 'https://teable.ai/cookies';

/**
 * Cookie banner for visitors who land on the app directly (the marketing
 * site has its own; both share the `teable_consent` cookie). Shown to opt-in
 * regions until they choose, and to anyone who opens "Cookie settings".
 * Reject and Accept carry equal weight, as the EDPB guidelines require.
 */
export const CookieConsentBanner = ({ enabled }: { enabled: boolean }) => {
  const { t } = useTranslation('common');
  const { needsChoice, settingsOpen } = useMarketingConsent();

  if (!enabled || !(needsChoice || settingsOpen)) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('cookieConsent.title')}
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-lg border bg-background p-4 shadow-lg sm:inset-x-6 sm:bottom-6"
    >
      <p className="text-sm font-medium">{t('cookieConsent.title')}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('cookieConsent.body')}{' '}
        <a className="underline" href={COOKIE_POLICY_URL} target="_blank" rel="noreferrer">
          {t('cookieConsent.policy')}
        </a>
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {settingsOpen && !needsChoice && (
          <Button size="sm" variant="ghost" onClick={closeCookieSettings}>
            {t('actions.cancel')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => saveConsent(allConsent('denied'))}>
          {t('cookieConsent.reject')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => saveConsent(allConsent('granted'))}>
          {t('cookieConsent.accept')}
        </Button>
      </div>
    </div>
  );
};
