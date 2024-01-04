import { ChevronsLeft } from '@teable-group/icons';
import { LocalStorageKeys, useIsHydrated, useIsMobile } from '@teable-group/sdk';
import { ResizablePanelGroup, ResizableHandle, ResizablePanel, Button } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { isString } from 'lodash';
import React, { useRef, useState, useEffect } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { HoverWraper } from '../../blocks/base/base-side-bar/HoverWraper';
import { SheetWraper } from '../../blocks/base/base-side-bar/SheetWraper';
import { SideBar } from '../../blocks/base/base-side-bar/SideBar';

const ResizeblePanelsPrefix = 'react-resizable-panels';

enum ResizePart {
  LEFT = 'left',
  CENTER = 'center',
  RIGHT = 'right',
}

export const ResizablePane: React.FC<{
  children: React.ReactElement[];
}> = ({ children }) => {
  const isMobile = useIsMobile();
  const isHydrated = useIsHydrated();
  const [left, center, right] = children;
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [leftVisible, setLeftVisible] = useState<boolean>(true);
  const leftMenuRef = useRef<React.ComponentRef<typeof ResizablePanel>>(null);

  useEffect(() => {
    const sizeString = localStorage.getItem(
      `${ResizeblePanelsPrefix}:${LocalStorageKeys.SideBarSize}`
    );
    if (isString(sizeString)) {
      const sizeObj = JSON.parse(sizeString);
      const keys = Object.keys(sizeObj);
      const key = keys?.[0];
      const collapseSize = sizeObj?.[key]?.expandToSizes?.[ResizePart.LEFT];
      setOffset(collapseSize || 25);
    }
  }, []);

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
              <ChevronsLeft className="h-5 w-5 rotate-180" />
            </Button>
          </HoverWraper.Trigger>
          <HoverWraper.content>
            <SideBar></SideBar>
          </HoverWraper.content>
        </HoverWraper>
      )}

      <ResizablePanelGroup
        direction="horizontal"
        className="relative"
        autoSaveId={LocalStorageKeys.SideBarSize}
      >
        {isMobile ? (
          <SheetWraper>{left}</SheetWraper>
        ) : (
          <ResizablePanel
            id={ResizePart.LEFT}
            order={1}
            className={classNames('h-full')}
            minSize={15}
            defaultSize={25}
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
            {React.cloneElement(left, { expandSideBar: () => leftMenuRef?.current?.collapse() })}
          </ResizablePanel>
        )}
        <ResizableHandle
          className={classNames('after:z-50 hover:after:w-1 hover:after:bg-violet-600', {
            hidden: !leftVisible,
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
