import type { DriverClient } from '@teable/core';
import type { IUser } from '@teable/sdk';
import { AppProvider, SessionProvider } from '@teable/sdk';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { AppLayout } from '@/features/app/layouts';
import { Sidebar } from '../components/sidebar/Sidebar';
import { SidebarContent } from '../components/sidebar/SidebarContent';
import { SidebarHeaderLeft } from '../components/sidebar/SidebarHeaderLeft';
import { useSdkLocale } from '../hooks/useSdkLocale';
import { useSettingRoute } from './useSettingRoute';

export const SettingLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  driver: DriverClient;
  dehydratedState?: unknown;
}> = ({ children, user, dehydratedState }) => {
  const router = useRouter();
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  const { t } = useTranslation(['setting', 'common']);

  const routes = useSettingRoute();

  const onBack = () => {
    router.push('/');
  };

  return (
    <AppLayout>
      <AppProvider lang={i18n.language} locale={sdkLocale} dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <div id="portal" className="relative flex h-screen w-full items-start">
            <Sidebar
              headerLeft={<SidebarHeaderLeft title={t('common:settings.title')} onBack={onBack} />}
            >
              <SidebarContent routes={routes} />
            </Sidebar>
            {children}
          </div>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
