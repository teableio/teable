import type { DriverClient } from '@teable/core';
import type { IUser } from '@teable/sdk';
import { AppProvider, SessionProvider } from '@teable/sdk';
import React from 'react';
import { AppLayout } from '@/features/app/layouts';
import { useSdkLocale } from '../hooks/useSdkLocale';

export const SettingLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  driver: DriverClient;
  dehydratedState?: unknown;
}> = ({ children, user, driver, dehydratedState }) => {
  const sdkLocale = useSdkLocale();
  return (
    <AppLayout>
      <AppProvider locale={sdkLocale} dehydratedState={dehydratedState} driver={driver}>
        <SessionProvider user={user}>
          <div id="portal" className="relative flex h-screen w-full items-start px-5">
            {children}
          </div>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
