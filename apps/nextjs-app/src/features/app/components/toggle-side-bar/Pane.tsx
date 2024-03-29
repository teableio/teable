import { ChevronsLeft } from '@teable/icons';
import { useIsHydrated, useIsMobile } from '@teable/sdk';
import { Button } from '@teable/ui-lib';
import { cn } from '@teable/ui-lib/shadcn';
import React, { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { SideBar } from '../../blocks/base/base-side-bar/SideBar';
import { SIDEBARWIDTH } from './constant';
import { HoverWraper } from './HoverWraper';
import { SheetWrapper } from './SheetWrapper';

export const Pane: React.FC<{
  children: React.ReactNode[];
}> = ({ children }) => {
  const isMobile = useIsMobile();
  const isHydrated = useIsHydrated();
  const [left, center, right] = children;
  const [leftVisible, setLeftVisible] = useState<boolean>(true);

  useHotkeys(`meta+b`, () => {
    setLeftVisible(!leftVisible);
  });

  if (!isHydrated) {
    return (
      <>
        <div className="flex h-full w-72 border-r">{left}</div>
        {center}
        {right}
      </>
    );
  }

  return (
    <>
      {!leftVisible && !isMobile && (
        <HoverWraper size={SIDEBARWIDTH}>
          <HoverWraper.Trigger>
            <Button
              className={cn('absolute top-7 z-[51] p-1 rounded-none -left-0 rounded-r-full')}
              variant={'outline'}
              size="xs"
              onClick={() => {
                setLeftVisible(!leftVisible);
              }}
            >
              <ChevronsLeft className="size-5 rotate-180" />
            </Button>
          </HoverWraper.Trigger>
          <HoverWraper.content>
            <SideBar></SideBar>
          </HoverWraper.content>
        </HoverWraper>
      )}

      <div className="flex h-screen w-full">
        {isMobile ? (
          <SheetWrapper>{left}</SheetWrapper>
        ) : (
          <div
            className={cn('transition-all flex w-0 border-r will-change-auto', {
              'overflow-hidden': !leftVisible,
            })}
            style={{
              width: leftVisible ? `${SIDEBARWIDTH}px` : '',
            }}
          >
            {React.cloneElement(left as React.ReactElement, {
              expandSideBar: () => setLeftVisible(!leftVisible),
            })}
          </div>
        )}
        <div className="min-w-80 flex-1">{center}</div>
        {right}
      </div>
    </>
  );
};
