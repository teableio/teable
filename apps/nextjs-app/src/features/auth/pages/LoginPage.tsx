import { QueryClientProvider } from '@tanstack/react-query';
import { TeableNew } from '@teable-group/icons';
import { useQueryClient } from '@teable-group/sdk';
import { Tabs, TabsList, TabsTrigger } from '@teable-group/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import { useRouter } from 'next/router';
import { useState, type FC, useCallback } from 'react';
import { authConfig } from '@/features/auth/auth.config';
import type { ISignForm } from '../components/SignForm';
import { SignForm } from '../components/SignForm';

export const LoginPage: FC = () => {
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const router = useRouter();
  const queryClient = useQueryClient();
  const redirect = router.query.redirect as string;
  const [signType, setSignType] = useState<ISignForm['type']>('signin');
  const onSuccess = useCallback(() => {
    router.push(redirect ? decodeURIComponent(redirect) : '/space');
  }, [router, redirect]);
  return (
    <QueryClientProvider client={queryClient}>
      <NextSeo title={t('auth:page.title')} />
      <div className="fixed w-full h-screen overflow-y-auto">
        <div className="absolute w-full left-0 px-5 flex justify-between items-center h-[4em] lg:h-20 bg-background">
          <div className="h-full flex items-center gap-2">
            <TeableNew className="w-8 h-8" />
            Teable
          </div>
          <Tabs value={signType} onValueChange={(val) => setSignType(val as ISignForm['type'])}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <SignForm
          className="w-80 h-full items-center mx-auto py-[5em] lg:py-24"
          type={signType}
          onSuccess={onSuccess}
        />
      </div>
    </QueryClientProvider>
  );
};
