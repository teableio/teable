import type { ITableVo } from '@teable/core';
import type { IGetBaseVo } from '@teable/openapi';
import { NotificationProvider, SessionProvider } from '@teable/sdk';
import type { IUser } from '@teable/sdk';
import { AnchorContext, AppProvider, BaseProvider, TableProvider } from '@teable/sdk/context';
import { useRouter } from 'next/router';
import React from 'react';
import { SideBar } from '@/features/app/blocks/base/base-side-bar/SideBar';
import { AppLayout } from '@/features/app/layouts';
import { Pane } from '../components/toggle-side-bar/Pane';
import { useSdkLocale } from '../hooks/useSdkLocale';

export const BaseLayout: React.FC<{
  children: React.ReactNode;
  tableServerData: ITableVo[];
  baseServerData: IGetBaseVo;
  user?: IUser;
}> = ({ children, tableServerData, baseServerData, user }) => {
  const router = useRouter();
  const { baseId, tableId, viewId } = router.query;
  const sdkLocale = useSdkLocale();

  return (
    <AppLayout>
      <AppProvider locale={sdkLocale}>
        <SessionProvider user={user}>
          <NotificationProvider>
            <AnchorContext.Provider
              value={{
                baseId: baseId as string,
                tableId: tableId as string,
                viewId: viewId as string,
              }}
            >
              <BaseProvider serverData={baseServerData}>
                <TableProvider serverData={tableServerData}>
                  <div id="portal" className="relative flex h-screen w-full items-start">
                    <Pane>
                      <SideBar />
                      {children}
                    </Pane>
                  </div>
                </TableProvider>
              </BaseProvider>
            </AnchorContext.Provider>
          </NotificationProvider>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
