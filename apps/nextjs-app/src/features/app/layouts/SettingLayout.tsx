import type { DriverClient } from '@teable/core';
import { Key } from '@teable/icons';
import type { IUser } from '@teable/sdk';
import { AppProvider, SessionProvider } from '@teable/sdk';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useMemo } from 'react';
import { AppLayout } from '@/features/app/layouts';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';
import { Sidebar } from '../components/sidebar/Sidebar';
import { SidebarContent } from '../components/sidebar/SidebarContent';
import { SidebarHeaderLeft } from '../components/sidebar/SidebarHeaderLeft';
import { useSdkLocale } from '../hooks/useSdkLocale';

export const SettingLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  driver: DriverClient;
  dehydratedState?: unknown;
}> = ({ children, user, dehydratedState }) => {
  const router = useRouter();
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  const { t } = useTranslation(personalAccessTokenConfig.i18nNamespaces);

  const routes = useMemo(() => {
    return [
      {
        Icon: Key,
        label: t('token:title'),
        route: '/setting/personal-access-token',
        pathTo: '/setting/personal-access-token',
      },
    ];
  }, [t]);

  const onBack = () => {
    router.push('/');
  };

  return (
    <AppLayout>
      <AppProvider lang={i18n.language} locale={sdkLocale} dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <div id="portal" className="relative flex h-screen w-full items-start">
            <Sidebar headerLeft={<SidebarHeaderLeft title={t('settings.title')} onBack={onBack} />}>
              <SidebarContent routes={routes} />
            </Sidebar>
            {children}
          </div>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
