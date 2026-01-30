import { ChevronsLeft } from '@teable/icons';
import { useIsHydrated, useIsMobile, useIsTemplate } from '@teable/sdk';
import { Button, cn } from '@teable/ui-lib';
import { Resizable } from 're-resizable';
import type { FC, PropsWithChildren, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  MAX_SIDE_BAR_WIDTH,
  MIN_SIDE_BAR_WIDTH,
  SIDE_BAR_WIDTH,
} from '../toggle-side-bar/constant';
import { HoverWrapper } from '../toggle-side-bar/HoverWrapper';
import { SheetWrapper } from '../toggle-side-bar/SheetWrapper';
import { SidebarHeader } from './SidebarHeader';
import { useSidebarStore } from './useSidebarStore';

interface ISidebarProps {
  headerLeft: ReactNode;
  headerRight?: ReactNode;
  className?: string;
}

const useSidebar = () => {
  const isTemplate = useIsTemplate();
  const [isVisible, setVisible] = useState(true);
  const [width, setWidth] = useState(SIDE_BAR_WIDTH);
  const storedSidebarStore = useSidebarStore();
  return useMemo(() => {
    if (isTemplate) {
      return {
        isVisible,
        setVisible,
        setWidth,
        width,
      };
    }
    return storedSidebarStore;
  }, [isVisible, setVisible, setWidth, width, isTemplate, storedSidebarStore]);
};

export const Sidebar: FC<PropsWithChildren<ISidebarProps>> = (props) => {
  const { headerLeft, headerRight, children, className } = props;
  const isMobile = useIsMobile();
  const { isVisible, setVisible, setWidth, width } = useSidebar();
  const isHydrated = useIsHydrated();
  const toggleSidebar = useCallback(() => {
    setVisible(!isVisible);
  }, [isVisible, setVisible]);
  useHotkeys(`mod+b`, toggleSidebar);

  const sidebarClassName = cn(
    'group/sidebar flex size-full flex-col overflow-hidden bg-background',
    className
  );

  const sidebarContent = useMemo(
    () => (
      <>
        <SidebarHeader headerLeft={headerLeft} headerRight={headerRight} onExpand={toggleSidebar} />
        {children}
      </>
    ),
    [headerLeft, headerRight, children, toggleSidebar]
  );

  // During SSR/hydration, render consistent layout to avoid mismatch
  if (!isHydrated) {
    return (
      <div
        className="h-full shrink-0 border-r"
        style={{ width: `var(--sidebar-width` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className={sidebarClassName}>{sidebarContent}</div>
      </div>
    );
  }

  // After hydration, safe to check client-only values
  if (isMobile) {
    return (
      <SheetWrapper>
        <div className={sidebarClassName}>
          <SidebarHeader headerLeft={headerLeft} headerRight={headerRight} />
          {children}
        </div>
      </SheetWrapper>
    );
  }

  // Collapsed state: show trigger button with hover panel
  if (!isVisible) {
    return (
      <HoverWrapper size={width}>
        <HoverWrapper.Trigger>
          <Button
            className="fixed left-0 top-7 z-40 rounded-none rounded-r-full p-1"
            variant="outline"
            size="xs"
            onClick={toggleSidebar}
          >
            <ChevronsLeft className="size-5 rotate-180" />
          </Button>
        </HoverWrapper.Trigger>
        <HoverWrapper.content>
          <div className={sidebarClassName} onContextMenu={(e) => e.preventDefault()}>
            <SidebarHeader headerLeft={headerLeft} headerRight={headerRight} />
            {children}
          </div>
        </HoverWrapper.content>
      </HoverWrapper>
    );
  }

  return (
    <Resizable
      className="h-full shrink-0 border-r"
      size={{ width, height: '100%' }}
      defaultSize={{ width, height: '100%' }}
      minWidth={MIN_SIDE_BAR_WIDTH}
      maxWidth={MAX_SIDE_BAR_WIDTH}
      enable={{ right: true }}
      onResizeStop={(_e, _direction, ref) => {
        const newWidth = parseInt(ref.style.width, 10);
        if (!isNaN(newWidth)) {
          if (newWidth <= MIN_SIDE_BAR_WIDTH) {
            setVisible(false);
          } else {
            setWidth(newWidth);
          }
        }
      }}
      handleClasses={{ right: 'group' }}
      handleStyles={{
        right: {
          width: '6px',
          right: '-6px',
        },
      }}
      handleComponent={{
        right: (
          <div className="h-full w-px bg-transparent transition-colors group-hover:bg-primary/50 group-active:bg-primary" />
        ),
      }}
    >
      <div className={sidebarClassName} onContextMenu={(e) => e.preventDefault()}>
        {sidebarContent}
      </div>
    </Resizable>
  );
};
