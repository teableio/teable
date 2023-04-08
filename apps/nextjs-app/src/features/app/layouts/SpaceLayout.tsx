import type { ITableVo } from '@teable-group/core';
import { AppProvider, TableProvider } from '@teable-group/sdk/context';
import { useRouter } from 'next/router';
import { SideBar } from '@/features/app/components/SideBar';
import { AppLayout } from '@/features/app/layouts';
import { ChatWindow } from '../components/ai-chat/ChatWindow';

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
          <div id="portal" className="h-screen flex items-start w-full">
            <SideBar />
            {children}
            <ChatWindow />
          </div>
        </TableProvider>
      </AppProvider>
    </AppLayout>
  );
};
