import type { IUser } from '@teable-group/sdk';
import { AppProvider, SessionProvider } from '@teable-group/sdk';
import React from 'react';
import { AppLayout } from '@/features/app/layouts';
import { useSdkLocale } from '../hooks/useSdkLocale';

export const SettingLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  dehydratedState?: unknown;
}> = ({ children, user, dehydratedState }) => {
  const sdkLocale = useSdkLocale();
  return (
    <AppLayout>
      <AppProvider locale={sdkLocale} dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <div id="portal" className="relative flex h-screen w-full items-start px-5">
            {children}
          </div>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
