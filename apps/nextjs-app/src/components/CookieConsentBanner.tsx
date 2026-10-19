import type { ConsentMethod, IMarketingConsent } from '@teable/core';
import { allConsent, consentForCategories, isConsentGranted } from '@teable/core';
import { Button, Label, Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useId, useState } from 'react';
import { closeCookieSettings, saveConsent, useMarketingConsent } from '@/lib/marketing-consent';

const COOKIE_POLICY_URL = 'https://teable.ai/cookies';

type ConsentCategory = 'necessary' | 'analytics' | 'marketing';

const CategoryCard = ({
  category,
  checked,
  onCheckedChange,
}: {
  category: ConsentCategory;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) => {
  const { t } = useTranslation('common');
  const id = useId();
  const locked = category === 'necessary';
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {t(`cookieConsent.categories.${category}.title`)}
        </Label>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(`cookieConsent.categories.${category}.description`)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {locked && (
          <span className="text-xs text-muted-foreground">{t('cookieConsent.alwaysOn')}</span>
        )}
        <Switch id={id} checked={checked} disabled={locked} onCheckedChange={onCheckedChange} />
      </div>
    </div>
  );
};

/**
 * Per-category choice. Mounted fresh each time it opens, so the switches start
 * from the current state: the saved choice if there is one, otherwise the
 * region default (off in opt-in regions, on elsewhere).
 */
const ConsentPreferences = ({
  initial,
  onCancel,
  onSave,
}: {
  initial: { analytics: boolean; marketing: boolean };
  onCancel?: () => void;
  onSave: (consent: IMarketingConsent, method: ConsentMethod) => void;
}) => {
  const { t } = useTranslation('common');
  const [analytics, setAnalytics] = useState(initial.analytics);
  const [marketing, setMarketing] = useState(initial.marketing);

  return (
    <>
      <p className="text-sm font-medium">{t('cookieConsent.settings')}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('cookieConsent.customBody')}{' '}
        <a className="underline" href={COOKIE_POLICY_URL} target="_blank" rel="noreferrer">
          {t('cookieConsent.policy')}
        </a>
      </p>
      <div className="mt-3 space-y-2">
        <CategoryCard category="necessary" checked />
        <CategoryCard category="analytics" checked={analytics} onCheckedChange={setAnalytics} />
        <CategoryCard category="marketing" checked={marketing} onCheckedChange={setMarketing} />
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSave(allConsent('denied'), 'reject_all')}
        >
          {t('cookieConsent.reject')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSave(allConsent('granted'), 'accept_all')}
        >
          {t('cookieConsent.accept')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSave(consentForCategories({ analytics, marketing }), 'custom')}
        >
          {t('cookieConsent.save')}
        </Button>
      </div>
    </>
  );
};

/**
 * Cookie banner for visitors who land on the app directly (the marketing
 * site has its own; both share the `teable_consent` cookie). Shown to opt-in
 * regions until they choose, and to anyone who opens "Cookie settings" — which
 * goes straight to the per-category panel. Every choice button carries equal
 * weight, as the EDPB guidelines require.
 */
export const CookieConsentBanner = ({ enabled }: { enabled: boolean }) => {
  const { t } = useTranslation('common');
  const { needsChoice, settingsOpen, analyticsGranted, region, consent } = useMarketingConsent();
  // Marketing writes all three ad signals on save, so it starts on only when all three are
  // granted: a saved ad_user_data denial must not be turned into a grant by an unrelated save.
  const marketingGranted = (['ad_storage', 'ad_user_data', 'ad_personalization'] as const).every(
    (category) => isConsentGranted(region, consent, category)
  );
  const [customizing, setCustomizing] = useState(false);

  if (!enabled || !(needsChoice || settingsOpen)) {
    return null;
  }

  const save = (consent: IMarketingConsent, method: ConsentMethod) => {
    setCustomizing(false);
    saveConsent(consent, method);
  };
  const cancel = () => {
    setCustomizing(false);
    closeCookieSettings();
  };
  const showPreferences = settingsOpen || customizing;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t(showPreferences ? 'cookieConsent.settings' : 'cookieConsent.title')}
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-h-[calc(100dvh-1.5rem)] max-w-2xl overflow-y-auto rounded-lg border bg-background p-4 shadow-lg sm:inset-x-6 sm:bottom-6 sm:max-h-[calc(100dvh-3rem)]"
    >
      {showPreferences ? (
        <ConsentPreferences
          initial={{ analytics: analyticsGranted, marketing: marketingGranted }}
          onCancel={settingsOpen && !needsChoice ? cancel : undefined}
          onSave={save}
        />
      ) : (
        <>
          <p className="text-sm font-medium">{t('cookieConsent.title')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('cookieConsent.body')}{' '}
            <a className="underline" href={COOKIE_POLICY_URL} target="_blank" rel="noreferrer">
              {t('cookieConsent.policy')}
            </a>
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => save(allConsent('denied'), 'reject_all')}
            >
              {t('cookieConsent.reject')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => save(allConsent('granted'), 'accept_all')}
            >
              {t('cookieConsent.accept')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCustomizing(true)}>
              {t('cookieConsent.customize')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
