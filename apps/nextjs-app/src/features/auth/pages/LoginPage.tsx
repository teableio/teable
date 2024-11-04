import { TeableNew } from '@teable/icons';
import { Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import { useState, useCallback } from 'react';
import { authConfig } from '@/features/i18n/auth.config';
import type { ISignForm } from '../components/SignForm';
import { SignForm } from '../components/SignForm';
import { SocialAuth } from '../components/SocialAuth';

export const LoginPage = (props: { children?: React.ReactNode | React.ReactNode[] }) => {
  const { children } = props;
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const router = useRouter();
  const redirect = router.query.redirect as string;
  const [signType, setSignType] = useState<ISignForm['type']>('signin');
  const onSuccess = useCallback(() => {
    window.location.href = redirect ? decodeURIComponent(redirect) : '/space';
  }, [redirect]);

  return (
    <>
      <NextSeo title={t('auth:page.title')} />
      <div className="fixed h-screen w-full overflow-y-auto">
        <div className="absolute left-0 flex h-[4em] w-full items-center justify-between bg-background px-5 lg:h-20">
          <div className="flex h-full items-center gap-2">
            <TeableNew className="size-8 text-black" />
            {t('common:brand')}
          </div>
          <Tabs value={signType} onValueChange={(val) => setSignType(val as ISignForm['type'])}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{t('auth:button.signin')}</TabsTrigger>
              <TabsTrigger value="signup">{t('auth:button.signup')}</TabsTrigger>
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
