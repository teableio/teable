import type { ITableVo } from '@teable-group/core';
import { AnchorContext, AppProvider, TableProvider } from '@teable-group/sdk/context';
import { Allotment } from 'allotment';
import { useRouter } from 'next/router';
import React, { useState } from 'react';
import { useLocalStorage } from 'react-use';
import { SideBar } from '@/features/app/blocks/side-bar/SideBar';
import { AppLayout } from '@/features/app/layouts';
import { useIsHydrated } from '@/lib/use-is-hydrated';
import { ChatWindow } from '../components/ai-chat/ChatWindow';
import 'allotment/dist/style.css';
import { OpenLeftSide } from '../components/open-lside/OpenLeftSide';
import { OpenRightSide } from '../components/open-lside/OpenRightSide';

const minSize = 150;

export const SpaceLayout: React.FC<{
  children: React.ReactNode;
  tableServerData: ITableVo[];
}> = ({ children, tableServerData }) => {
  const router = useRouter();
  const { nodeId, viewId } = router.query;
  const [size, setSize] = useLocalStorage<number[]>('side-bar-size');
  const [leftVisible, setLeftVisible] = useState<boolean>(Boolean(size?.[0] && size[0] > minSize));
  const [rightVisible, setRightVisible] = useState<boolean>(
    Boolean(size?.[2] && size[2] > minSize)
  );
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return <></>;
  }
  return (
    <AppLayout>
      <AppProvider>
        <AnchorContext.Provider value={{ tableId: nodeId as string, viewId: viewId as string }}>
          <TableProvider serverData={tableServerData}>
            <div id="portal" className="h-screen flex items-start w-full relative">
              {!leftVisible && (
                <OpenLeftSide
                  onClick={() => {
                    setLeftVisible(true);
                  }}
                />
              )}
              {!rightVisible && (
                <OpenRightSide
                  onClick={() => {
                    setRightVisible(true);
                  }}
                />
              )}
              <Allotment
                minSize={0}
                onChange={(size) => {
                  setLeftVisible(size[0] >= minSize);
                  setRightVisible(size[2] >= minSize);
                  setSize(size.map((s) => (s < minSize ? minSize : s)));
                }}
                defaultSizes={size}
              >
                <Allotment.Pane snap minSize={minSize} preferredSize={300} visible={leftVisible}>
                  <SideBar />
                </Allotment.Pane>
                <Allotment.Pane minSize={400}>{children}</Allotment.Pane>
                <Allotment.Pane minSize={minSize} preferredSize={200} snap visible={rightVisible}>
                  <ChatWindow />
                </Allotment.Pane>
              </Allotment>
            </div>
          </TableProvider>
        </AnchorContext.Provider>
      </AppProvider>
    </AppLayout>
  );
};
