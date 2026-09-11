import { useMutation } from '@tanstack/react-query';
import { createMobileAuthCode, signout } from '@teable/openapi';
import { UserAvatar } from '@teable/sdk/components';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import { useState } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { authConfig } from '@/features/i18n/auth.config';
import { LayoutMain } from '../components/LayoutMain';
import type { IMobileSignInAccount, IMobileSignInPageProps } from './mobile-sign-in.server';

/** Who the app would be signed in as: avatar, name and email, so a wrong account is obvious. */
const AccountCard = ({ account }: { account: IMobileSignInAccount }) => (
  <div className="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-start">
    <UserAvatar name={account.name} avatar={account.avatar ?? undefined} className="size-10" />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{account.name}</p>
      <p className="truncate text-xs text-muted-foreground">{account.email}</p>
    </div>
  </div>
);

/**
 * Consent step of the mobile sign-in: shows which account the app would get, mints the
 * one-time code only on the user's click, then bounces the browser to the app (with a button
 * for browsers that block automatic scheme redirects). "Use another account" signs this
 * browser out and runs the regular login with this page as its redirect, so the user lands
 * back here with the account they meant.
 */
export const MobileSignInPage = ({ account, request, error }: IMobileSignInPageProps) => {
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const [cancelled, setCancelled] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string>();

  const switchAccount = useMutation({
    mutationFn: async () => {
      await signout();
    },
    onSuccess: () => {
      const here = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/auth/login?redirect=${encodeURIComponent(here)}`);
    },
  });
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
  const busy = authorize.isPending || switchAccount.isPending;

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
        <p className="text-sm text-muted-foreground">{t('auth:mobile.description')}</p>
        {account ? <AccountCard account={account} /> : null}
        {authorize.isError ? (
          <p className="text-sm text-destructive">{t('auth:mobile.failed')}</p>
        ) : null}
        {switchAccount.isError ? (
          <p className="text-sm text-destructive">{t('auth:mobile.switchFailed')}</p>
        ) : null}
        <div className="flex w-full flex-col gap-2">
          <Button onClick={() => authorize.mutate()} disabled={busy}>
            {t('auth:mobile.authorize')}
          </Button>
          <Button variant="outline" onClick={() => switchAccount.mutate()} disabled={busy}>
            {t('auth:mobile.switchAccount')}
          </Button>
          <Button variant="ghost" onClick={() => setCancelled(true)} disabled={busy}>
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
