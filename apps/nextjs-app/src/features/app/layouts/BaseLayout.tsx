import type { ITableVo } from '@teable-group/core';
import type { IGetBaseVo } from '@teable-group/openapi';
import { NotificationProvider, SessionProvider } from '@teable-group/sdk';
import type { IUser } from '@teable-group/sdk';
import { AnchorContext, AppProvider, BaseProvider, TableProvider } from '@teable-group/sdk/context';
import { useRouter } from 'next/router';
import React from 'react';
import { SideBar } from '@/features/app/blocks/base/base-side-bar/SideBar';
import { AppLayout } from '@/features/app/layouts';
// import { ChatWindow } from '../components/ai-chat/ChatWindow';
import { ResizablePane } from '../components/toggle-side-bar/ResizablePane';

export const BaseLayout: React.FC<{
  children: React.ReactNode;
  tableServerData: ITableVo[];
  baseServerData: IGetBaseVo;
  user?: IUser;
}> = ({ children, tableServerData, baseServerData, user }) => {
  const router = useRouter();
  const { baseId, nodeId, viewId } = router.query;

  return (
    <AppLayout>
      <AppProvider>
        <SessionProvider user={user}>
          <NotificationProvider>
            <AnchorContext.Provider
              value={{
                baseId: baseId as string,
                tableId: nodeId as string,
                viewId: viewId as string,
              }}
            >
              <BaseProvider serverData={baseServerData}>
                <TableProvider serverData={tableServerData}>
                  <div id="portal" className="relative flex h-screen w-full items-start">
                    <ResizablePane>
                      <SideBar />
                      {children}
                    </ResizablePane>
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
