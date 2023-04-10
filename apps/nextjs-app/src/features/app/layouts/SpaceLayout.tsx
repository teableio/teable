import type { ITableVo } from '@teable-group/core';
import { AppProvider, TableProvider } from '@teable-group/sdk/context';
import { useRouter } from 'next/router';
import { Panel, PanelGroup } from 'react-resizable-panels';
import { SideBar } from '@/features/app/components/SideBar';
import { AppLayout } from '@/features/app/layouts';
import { ChatWindow } from '../components/ai-chat/ChatWindow';
import ResizeHandle from '../components/resizeHandle/ResizeHandle';

export const SpaceLayout: React.FC<{
  children: React.ReactNode;
  tableServerData: ITableVo[];
}> = ({ children, tableServerData }) => {
  const router = useRouter();
  const { nodeId, viewId } = router.query;

  return (
    <AppLayout>
      <AppProvider>
        <TableProvider
          tableId={nodeId as string}
          viewId={viewId as string}
          serverData={tableServerData}
        >
          <div id="portal" className="h-screen flex items-start w-full relative">
            <PanelGroup direction="horizontal" autoSaveId="main-panel">
              <Panel defaultSize={20} minSize={20}>
                <SideBar />
              </Panel>
              <ResizeHandle className="border-l border-base-300 hover:bg-base-300 hover:px-px" />
              <Panel minSize={30}>{children}</Panel>
              <ResizeHandle className="border-l border-base-300 hover:bg-base-300 hover:px-px" />
              <Panel defaultSize={20} minSize={20}>
                <ChatWindow />
              </Panel>
            </PanelGroup>
          </div>
        </TableProvider>
      </AppProvider>
    </AppLayout>
  );
};
