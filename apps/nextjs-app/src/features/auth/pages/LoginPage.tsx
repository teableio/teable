import { ScrollArea, cn } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import { useCallback, useEffect, useMemo } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { useAutoFavicon } from '@/features/app/hooks/useAutoFavicon';
import { useBrand } from '@/features/app/hooks/useBrand';
import { useEnv } from '@/features/app/hooks/useEnv';
import { useInitializationZodI18n } from '@/features/app/hooks/useInitializationZodI18n';
import { authConfig } from '@/features/i18n/auth.config';
import { isValidRedirectPath } from '@/lib/isValidRedirectPath';
import { DescContent } from '../components/DescContent';
import { SignForm } from '../components/SignForm';
import { SocialAuth } from '../components/SocialAuth';
import { Terms } from '../components/Terms';
import { useDisallowSignUp } from '../useDisallowSignUp';

const getAuthLinkClassName = (isActive: boolean) =>
  cn(
    'min-w-0 max-w-full break-words leading-none hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isActive
      ? 'text-3xl font-semibold text-foreground'
      : 'text-xl font-medium text-muted-foreground'
  );

export const LoginPage = (props: { children?: React.ReactNode | React.ReactNode[] }) => {
  const { children } = props;
  useInitializationZodI18n();
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const { brandName } = useBrand();
  const router = useRouter();
  useAutoFavicon();
  // Next has already URL-decoded router.query once. A second
  // decodeURIComponent here was a no-op for plain paths but mangled any
  // redirect whose OWN query holds percent-escapes (`/base/generation?prompt=…`
  // keeps its prompt single-encoded at this point): `%26`/`%23`/`%25` inside
  // the inner value decoded prematurely and split or truncated it on push.
  // The social path (SocialAuth → oauth store) never double-decoded — this
  // makes the password path agree with it.
  const redirect = (router.query.redirect as string) || '';
  const routeSignType = router.pathname.endsWith('/signup') ? 'signup' : 'signin';
  const { passwordLoginDisabled } = useEnv();
  const disallowSignUp = useDisallowSignUp();
  const hasInvitationRedirect = useMemo(() => {
    try {
      const base =
        typeof window !== 'undefined' ? window.location.origin : 'http://placeholder.local';
      const url = new URL(redirect, base);
      return url.searchParams.has('invitationId') && url.searchParams.has('invitationCode');
    } catch {
      return false;
    }
  }, [redirect]);
  const signType =
    routeSignType === 'signup' && disallowSignUp && !hasInvitationRedirect
      ? 'signin'
      : routeSignType;

  useEffect(() => {
    if (routeSignType !== 'signup' || !disallowSignUp || hasInvitationRedirect) {
      return;
    }

    void router.replace(
      {
        pathname: '/auth/login',
        query: { ...router.query },
      },
      undefined,
      { shallow: true }
    );
  }, [disallowSignUp, hasInvitationRedirect, routeSignType, router]);
  const onSuccess = useCallback(() => {
    if (redirect && isValidRedirectPath(redirect)) {
      router.push(redirect);
    } else {
      router.push({
        pathname: '/space',
        query: router.query,
      });
    }
  }, [redirect, router]);

  return (
    <ScrollArea className="h-screen">
      <div className="flex min-h-screen">
        <NextSeo title={signType === 'signin' ? t('auth:page.signin') : t('auth:page.signup')} />
        <DescContent />
        <div className="relative flex flex-1 shrink-0 flex-col items-center justify-start sm:justify-center">
          <div className="mt-5 flex w-[calc(100%-3rem)] flex-wrap items-center justify-start gap-2 text-start text-[22px] font-semibold leading-8 sm:fixed sm:start-5 sm:top-5 sm:mt-0 sm:w-max sm:flex-nowrap sm:text-[20px]">
            <TeableLogo className="size-8 shrink-0" />
            <span className="max-w-full shrink-0 truncate sm:max-w-none">{brandName}</span>
          </div>
          <div className="relative mt-7 w-80 max-w-[calc(100%-2.5rem)] pb-[5em] sm:mt-0 sm:max-w-none sm:py-[5em] lg:py-24">
            <nav className="mb-2 flex w-full flex-wrap items-baseline gap-x-6 gap-y-2">
              {(!disallowSignUp || hasInvitationRedirect) && (
                <Link
                  href={{ pathname: '/auth/signup', query: { ...router.query } }}
                  shallow
                  aria-current={signType === 'signup' ? 'page' : undefined}
                  className={getAuthLinkClassName(signType === 'signup')}
                >
                  {t('auth:button.signup')}
                </Link>
              )}
              <Link
                href={{ pathname: '/auth/login', query: { ...router.query } }}
                shallow
                aria-current={signType === 'signin' ? 'page' : undefined}
                className={getAuthLinkClassName(signType === 'signin')}
              >
                {t('auth:button.signin')}
              </Link>
            </nav>
            {!passwordLoginDisabled && <SignForm type={signType} onSuccess={onSuccess} />}
            <SocialAuth />
            {children}
            <Terms />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
};
