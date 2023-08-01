import type { ITableVo } from '@teable-group/core';
import { AnchorContext, AppProvider, TableProvider } from '@teable-group/sdk/context';
import { useRouter } from 'next/router';
import React from 'react';
import { SideBar } from '@/features/app/blocks/side-bar/SideBar';
import { AppLayout } from '@/features/app/layouts';
import { ChatWindow } from '../components/ai-chat/ChatWindow';
import { ResizablePane } from '../components/toggle-side-bar/ResizablePane';

export const SpaceLayout: React.FC<{
  children: React.ReactNode;
  tableServerData: ITableVo[];
}> = ({ children, tableServerData }) => {
  const router = useRouter();
  const { nodeId, viewId } = router.query;

  return (
    <AppLayout>
      <AppProvider>
        <AnchorContext.Provider value={{ tableId: nodeId as string, viewId: viewId as string }}>
          <TableProvider serverData={tableServerData}>
            <div id="portal" className="h-screen flex items-start w-full relative">
              <ResizablePane>
                <SideBar />
                {children}
                <ChatWindow />
              </ResizablePane>
            </div>
          </TableProvider>
        </AnchorContext.Provider>
      </AppProvider>
    </AppLayout>
  );
};
