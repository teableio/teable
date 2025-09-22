import { ChevronsLeft } from '@teable/icons';
import { useIsMobile } from '@teable/sdk';
import { useBuildBaseAgentStore } from '@teable/sdk/components/grid-enhancements/store/useBuildBaseAgentStore';
import { Button, cn } from '@teable/ui-lib';
import type { FC, PropsWithChildren, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { SIDE_BAR_WIDTH } from '../toggle-side-bar/constant';
import { HoverWrapper } from '../toggle-side-bar/HoverWrapper';
import { SheetWrapper } from '../toggle-side-bar/SheetWrapper';
import { SidebarHeader } from './SidebarHeader';
import { useChatPanelStore } from './useChatPanelStore';
import { useSidebarStore } from './useSidebarStore';

interface ISidebarProps {
  headerLeft: ReactNode;
  className?: string;
}

export const Sidebar: FC<PropsWithChildren<ISidebarProps>> = (props) => {
  const { headerLeft, children, className } = props;
  const isMobile = useIsMobile();
  const [leftVisible, setLeftVisible] = useState(true);

  const { setVisible } = useSidebarStore();

  const { status } = useChatPanelStore();

  const isExpanded = status === 'expanded';

  const { building } = useBuildBaseAgentStore();

  useHotkeys(`meta+b`, () => {
    setVisible(!leftVisible);
  });

  useEffect(() => {
    setVisible(leftVisible);
  }, [leftVisible, setVisible]);

  return (
    <>
      {isMobile ? (
        <SheetWrapper>
          <div
            className={cn('group/sidebar flex size-full flex-col overflow-hidden bg-popover p-5', {
              'rounded-l': building,
            })}
          >
            <SidebarHeader headerLeft={headerLeft} />
            {children}
          </div>
        </SheetWrapper>
      ) : (
        <div
          className={cn('flex w-0 flex-shrink-0 h-full border-r', {
            'overflow-hidden border-none': !leftVisible,
            'w-72': leftVisible,
            'border-none': isExpanded && !leftVisible,
          })}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className={cn(
              'group/sidebar flex size-full flex-col overflow-hidden bg-popover',
              {
                'rounded-l': building,
              },
              className
            )}
          >
            <SidebarHeader headerLeft={headerLeft} onExpand={() => setLeftVisible(!leftVisible)} />
            {leftVisible && children}
          </div>
        </div>
      )}

      {!isMobile && !leftVisible && (
        <HoverWrapper size={SIDE_BAR_WIDTH}>
          <HoverWrapper.Trigger>
            <Button
              className={cn('fixed top-7 p-1 rounded-none -left-0 rounded-r-full z-40', {
                '-left-1': building,
              })}
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
              className={cn(
                'group/sidebar flex size-full flex-col overflow-hidden bg-popover',
                {
                  'rounded-l': building,
                },
                className
              )}
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
