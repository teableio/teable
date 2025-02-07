import { ChevronsLeft } from '@teable/icons';
import { useIsMobile } from '@teable/sdk';
import { Button, cn } from '@teable/ui-lib';
import type { FC, PropsWithChildren, ReactNode } from 'react';
import { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { SIDE_BAR_WIDTH } from '../toggle-side-bar/constant';
import { HoverWrapper } from '../toggle-side-bar/HoverWrapper';
import { SheetWrapper } from '../toggle-side-bar/SheetWrapper';
import { SidebarHeader } from './SidebarHeader';

interface ISidebarProps {
  headerLeft: ReactNode;
}

export const Sidebar: FC<PropsWithChildren<ISidebarProps>> = (props) => {
  const { headerLeft, children } = props;
  const isMobile = useIsMobile();
  const [leftVisible, setLeftVisible] = useState(true);

  useHotkeys(`meta+b`, () => {
    setLeftVisible(!leftVisible);
  });

  return (
    <>
      {isMobile ? (
        <SheetWrapper>
          <div className="group/sidebar flex size-full flex-col overflow-hidden bg-popover p-5">
            <SidebarHeader headerLeft={headerLeft} />
            {children}
          </div>
        </SheetWrapper>
      ) : (
        <div
          className={cn('flex w-0 border-r flex-shrink-0 h-full', {
            'overflow-hidden': !leftVisible,
            'w-72': leftVisible,
          })}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="group/sidebar flex size-full flex-col overflow-hidden bg-popover">
            <SidebarHeader headerLeft={headerLeft} onExpand={() => setLeftVisible(!leftVisible)} />
            {leftVisible && children}
          </div>
        </div>
      )}

      {!isMobile && !leftVisible && (
        <HoverWrapper size={SIDE_BAR_WIDTH}>
          <HoverWrapper.Trigger>
            <Button
              className={cn('absolute top-7 p-1 rounded-none -left-0 rounded-r-full z-40')}
              variant={'outline'}
              size="xs"
              onClick={() => {
                setLeftVisible(!leftVisible);
              }}
            >
              <ChevronsLeft className="size-5 rotate-180" />
            </Button>
          </HoverWrapper.Trigger>
          <HoverWrapper.content>
            <div
              className="group/sidebar flex size-full flex-col overflow-hidden bg-popover"
              onContextMenu={(e) => e.preventDefault()}
            >
              <SidebarHeader headerLeft={headerLeft} />
              {children}
            </div>
          </HoverWrapper.content>
        </HoverWrapper>
      )}
    </>
  );
};
