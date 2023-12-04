import type { IUser } from '@teable-group/sdk';
import { NotificationProvider, SessionProvider } from '@teable-group/sdk';
import { AppProvider } from '@teable-group/sdk/context';
import React from 'react';
import { SideBar } from '@/features/app/blocks/space/space-side-bar/SideBar';
import { AppLayout } from '@/features/app/layouts';

export const SpaceLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  dehydratedState?: unknown;
}> = ({ children, user, dehydratedState }) => {
  return (
    <AppLayout>
      <AppProvider dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <div id="portal" className="relative flex h-screen w-full items-start">
            <SideBar />
            {children}
          </div>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
