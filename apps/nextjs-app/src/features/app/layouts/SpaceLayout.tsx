import type { IUser } from '@teable/sdk';
import { NotificationProvider, SessionProvider } from '@teable/sdk';
import { AppProvider } from '@teable/sdk/context';
import React from 'react';
import { SideBar } from '@/features/app/blocks/space/space-side-bar/SideBar';
import { AppLayout } from '@/features/app/layouts';
import { useSdkLocale } from '../hooks/useSdkLocale';

export const SpaceLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  dehydratedState?: unknown;
}> = ({ children, user, dehydratedState }) => {
  const sdkLocale = useSdkLocale();

  return (
    <AppLayout>
      <AppProvider locale={sdkLocale} dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <NotificationProvider>
            <div id="portal" className="relative flex h-screen w-full items-start">
              <SideBar />
              {children}
            </div>
          </NotificationProvider>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
