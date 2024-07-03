import type { DriverClient } from '@teable/core';
import type { IUser } from '@teable/sdk';
import { AppProvider, SessionProvider } from '@teable/sdk';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/features/app/layouts';
import { useSdkLocale } from '../hooks/useSdkLocale';

export const SpaceSettingLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  driver: DriverClient;
  dehydratedState?: unknown;
}> = ({ children, user, driver, dehydratedState }) => {
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  return (
    <AppLayout>
      <AppProvider
        lang={i18n.language}
        locale={sdkLocale}
        dehydratedState={dehydratedState}
        driver={driver}
      >
        <SessionProvider user={user}>
          <div id="space-settings" className="flex h-screen flex-col">
            {children}
          </div>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
