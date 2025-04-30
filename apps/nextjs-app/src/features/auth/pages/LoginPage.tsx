import { ScrollArea, Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import { useCallback } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { useAutoFavicon } from '@/features/app/hooks/useAutoFavicon';
import { useBrand } from '@/features/app/hooks/useBrand';
import { useEnv } from '@/features/app/hooks/useEnv';
import { useInitializationZodI18n } from '@/features/app/hooks/useInitializationZodI18n';
import { authConfig } from '@/features/i18n/auth.config';
import { DescContent } from '../components/DescContent';
import { SignForm } from '../components/SignForm';
import { SocialAuth } from '../components/SocialAuth';
import { Terms } from '../components/Terms';
import { useDisallowSignUp } from '../useDisallowSignUp';

export const LoginPage = (props: { children?: React.ReactNode | React.ReactNode[] }) => {
  const { children } = props;
  useInitializationZodI18n();
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const { brandName } = useBrand();
  const router = useRouter();
  useAutoFavicon();
  const redirect = decodeURIComponent((router.query.redirect as string) || '');
  const signType = router.pathname.endsWith('/signup') ? 'signup' : 'signin';
  const { passwordLoginDisabled } = useEnv();
  const disallowSignUp = useDisallowSignUp();

  const onSuccess = useCallback(() => {
    if (redirect && redirect.startsWith('/')) {
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
        <div className="fixed left-5 top-5 flex flex-none items-center gap-2">
          <TeableLogo className="size-8" />
          {brandName}
        </div>
        <DescContent />
        <div className="relative flex flex-1 shrink-0 flex-col items-center justify-center">
          <div className="absolute right-0 top-0 flex h-[4em] items-center justify-end bg-background px-5 lg:h-20">
            <Tabs value={signType}>
              <TabsList>
                <Link href={{ pathname: '/auth/login', query: { ...router.query } }} shallow>
                  <TabsTrigger value="signin">{t('auth:button.signin')}</TabsTrigger>
                </Link>
                {!disallowSignUp && (
                  <Link href={{ pathname: '/auth/signup', query: { ...router.query } }} shallow>
                    <TabsTrigger value="signup">{t('auth:button.signup')}</TabsTrigger>
                  </Link>
                )}
              </TabsList>
            </Tabs>
          </div>
          <div className="relative w-80 py-[5em] lg:py-24">
            {!passwordLoginDisabled && <SignForm type={signType} onSuccess={onSuccess} />}
            <SocialAuth />
            <Terms />
            {children}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
};
