import { QueryClientProvider } from '@tanstack/react-query';
import { TeableNew } from '@teable-group/icons';
import { createQueryClient } from '@teable-group/sdk/context/app/queryClient';
import { Tabs, TabsList, TabsTrigger } from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import { useState, type FC, useCallback } from 'react';
import { authConfig } from '@/features/i18n/auth.config';
import type { ISignForm } from '../components/SignForm';
import { SignForm } from '../components/SignForm';

const queryClient = createQueryClient();

export const LoginPage: FC = () => {
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const router = useRouter();
  const redirect = router.query.redirect as string;
  const [signType, setSignType] = useState<ISignForm['type']>('signin');
  const onSuccess = useCallback(() => {
    window.location.href = redirect ? decodeURIComponent(redirect) : '/space';
  }, [redirect]);
  return (
    <QueryClientProvider client={queryClient}>
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
        <SignForm
          className="mx-auto h-full w-80 items-center py-[5em] lg:py-24"
          type={signType}
          onSuccess={onSuccess}
        />
      </div>
    </QueryClientProvider>
  );
};
