import { TeableNew } from '@teable/icons';
import { Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import { useCallback } from 'react';
import { authConfig } from '@/features/i18n/auth.config';
import { SignForm } from '../components/SignForm';
import { SocialAuth } from '../components/SocialAuth';

export const LoginPage = (props: { children?: React.ReactNode | React.ReactNode[] }) => {
  const { children } = props;
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const router = useRouter();
  const redirect = decodeURIComponent((router.query.redirect as string) || '');
  const signType = router.pathname.endsWith('/signup') ? 'signup' : 'signin';

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
    <>
      <NextSeo title={t('auth:page.title')} />
      <div className="fixed h-screen w-full overflow-y-auto">
        <div className="absolute left-0 flex h-[4em] w-full items-center justify-between bg-background px-5 lg:h-20">
          <div className="flex h-full items-center gap-2">
            <TeableNew className="size-8 text-black" />
            {t('common:brand')}
          </div>
          <Tabs value={signType}>
            <TabsList className="grid w-full grid-cols-2">
              <Link href={{ pathname: '/auth/login', query: { ...router.query } }} shallow>
                <TabsTrigger value="signin">{t('auth:button.signin')}</TabsTrigger>
              </Link>
              <Link href={{ pathname: '/auth/signup', query: { ...router.query } }} shallow>
                <TabsTrigger value="signup">{t('auth:button.signup')}</TabsTrigger>
              </Link>
            </TabsList>
          </Tabs>
        </div>
        <div className="relative top-1/2 mx-auto w-80 -translate-y-1/2 py-[5em] lg:py-24">
          <SignForm type={signType} onSuccess={onSuccess} />
          <SocialAuth />
          {children}
        </div>
      </div>
    </>
  );
};
