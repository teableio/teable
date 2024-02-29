import { ChevronsLeft } from '@teable/icons';
import { useIsHydrated, useIsMobile } from '@teable/sdk';
import { Button } from '@teable/ui-lib';
import classNames from 'classnames';
import React, { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { HoverWraper } from '../../blocks/base/base-side-bar/HoverWraper';
import { SheetWraper } from '../../blocks/base/base-side-bar/SheetWraper';
import { SideBar } from '../../blocks/base/base-side-bar/SideBar';

const DefaultLeftSize = 240;

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
        {left}
        {center}
        {right}
      </>
    );
  }

  return (
    <>
      {!leftVisible && !isMobile && (
        <HoverWraper size={DefaultLeftSize}>
          <HoverWraper.Trigger>
            <Button
              className={classNames(
                'absolute top-7 z-[51] p-1 rounded-none -left-0 rounded-r-full'
              )}
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
          <SheetWraper>{left}</SheetWraper>
        ) : (
          <div
            className={classNames('transition-all flex w-0 border-r will-change-auto', {
              'w-60': leftVisible,
              'overflow-hidden': !leftVisible,
            })}
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
