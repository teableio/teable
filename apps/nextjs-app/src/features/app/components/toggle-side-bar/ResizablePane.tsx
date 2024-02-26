import { ChevronsLeft } from '@teable/icons';
import { useIsHydrated, useIsMobile } from '@teable/sdk';
import { ResizablePanelGroup, ResizableHandle, ResizablePanel, Button } from '@teable/ui-lib';
import classNames from 'classnames';
import React, { useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { HoverWraper } from '../../blocks/base/base-side-bar/HoverWraper';
import { SheetWraper } from '../../blocks/base/base-side-bar/SheetWraper';
import { SideBar } from '../../blocks/base/base-side-bar/SideBar';

enum ResizePart {
  LEFT = 'left',
  CENTER = 'center',
  RIGHT = 'right',
}

const DefaultLeftSize = 25;

export const ResizablePane: React.FC<{
  children: React.ReactNode[];
}> = ({ children }) => {
  const isMobile = useIsMobile();
  const isHydrated = useIsHydrated();
  const [left, center, right] = children;
  const [offset, setOffset] = useState(DefaultLeftSize);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [leftVisible, setLeftVisible] = useState<boolean>(true);
  const leftMenuRef = useRef<React.ComponentRef<typeof ResizablePanel>>(null);

  useHotkeys(`meta+b`, () => {
    if (leftVisible) {
      leftMenuRef?.current?.collapse();
    } else {
      leftMenuRef?.current?.expand();
    }
  });

  if (!isHydrated) {
    return (
      <>
        {left}
        {center}
        {right}
      </>
    );
  }

  return (
    <>
      {!leftVisible && !isMobile && (
        <HoverWraper size={offset}>
          <HoverWraper.Trigger>
            <Button
              className={classNames(
                'absolute top-7 z-[51] p-1 rounded-none -left-0 rounded-r-full'
              )}
              variant={'outline'}
              size="xs"
              onClick={() => {
                leftMenuRef?.current?.expand();
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

      <ResizablePanelGroup direction="horizontal" className="relative">
        {isMobile ? (
          <SheetWraper>{left}</SheetWraper>
        ) : (
          <ResizablePanel
            id={ResizePart.LEFT}
            order={1}
            className={classNames('h-full will-change-auto')}
            minSize={15}
            defaultSize={DefaultLeftSize}
            maxSize={30}
            collapsible={true}
            ref={leftMenuRef}
            onResize={(size) => {
              if (size === 0) {
                setLeftVisible(false);
              } else {
                setLeftVisible(true);
                setOffset(size);
              }
            }}
            style={{
              transition: !isDragging ? 'flex 100ms ease-in-out 0s' : 'none 0s ease 0s',
            }}
          >
            {React.cloneElement(left as React.ReactElement, {
              expandSideBar: () => leftMenuRef?.current?.collapse(),
            })}
          </ResizablePanel>
        )}
        <ResizableHandle
          className={classNames('after:z-50 hover:after:w-1 hover:after:bg-violet-600', {
            hidden: !leftVisible,
            'after:bg-violet-600': isDragging,
          })}
          onDragging={(drag) => {
            setIsDragging(drag);
          }}
        />
        <ResizablePanel className="min-w-80" id={ResizePart.CENTER} order={2}>
          {center}
        </ResizablePanel>
        {right && (
          <ResizablePanel id={ResizePart.RIGHT} order={3}>
            {right}
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    </>
  );
};
