import { useMutation } from '@tanstack/react-query';
import { createMobileAuthCode } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import { useState } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { authConfig } from '@/features/i18n/auth.config';
import { LayoutMain } from '../components/LayoutMain';
import type { IMobileSignInPageProps } from './mobile-sign-in.server';

/**
 * Consent step of the mobile sign-in: shows which account the app would get, mints the
 * one-time code only on the user's click, then bounces the browser to the app (with a button
 * for browsers that block automatic scheme redirects).
 */
export const MobileSignInPage = ({ email, request, error }: IMobileSignInPageProps) => {
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const [cancelled, setCancelled] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string>();

  const authorize = useMutation({
    mutationFn: async () => {
      if (!request) throw new Error('invalid_request');
      const { data } = await createMobileAuthCode(request);
      return data;
    },
    onSuccess: ({ redirectUrl: url }) => {
      setRedirectUrl(url);
      window.location.assign(url);
    },
  });

  let body: React.ReactNode;
  if (error || !request) {
    body = <p className="text-sm text-destructive">{t('auth:mobile.invalidRequest')}</p>;
  } else if (cancelled) {
    body = <p className="text-sm text-muted-foreground">{t('auth:mobile.cancelled')}</p>;
  } else if (redirectUrl) {
    body = (
      <>
        <p className="text-sm text-muted-foreground">{t('auth:mobile.returning')}</p>
        <Button asChild>
          <a href={redirectUrl}>{t('auth:mobile.openApp')}</a>
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-sm text-muted-foreground">{t('auth:mobile.description', { email })}</p>
        {authorize.isError ? (
          <p className="text-sm text-destructive">{t('auth:mobile.failed')}</p>
        ) : null}
        <div className="flex w-full flex-col gap-2">
          <Button onClick={() => authorize.mutate()} disabled={authorize.isPending}>
            {t('auth:mobile.authorize')}
          </Button>
          <Button variant="ghost" onClick={() => setCancelled(true)} disabled={authorize.isPending}>
            {t('auth:mobile.cancel')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <LayoutMain>
      <NextSeo title={t('auth:mobile.title')} />
      <div className="flex flex-col items-center gap-6 text-center">
        <TeableLogo className="size-12" />
        <h1 className="text-2xl font-semibold">{t('auth:mobile.title')}</h1>
        {body}
      </div>
    </LayoutMain>
  );
};
