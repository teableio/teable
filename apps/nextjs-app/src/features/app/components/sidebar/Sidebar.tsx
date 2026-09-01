import { ChevronsLeft } from '@teable/icons';
import { useIsHydrated, useIsMobile, useIsReadOnlyPreview } from '@teable/sdk';
import { Button, cn, useUiDirection } from '@teable/ui-lib';
import { Resizable } from 're-resizable';
import type { FC, PropsWithChildren, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { preventContextMenuUnlessText } from '../../utils/prevent-context-menu';
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
  mobileTriggerTopOffset?: string;
  temporarilyCollapsed?: boolean;
  onTemporaryExpand?: () => void;
}

const useSidebar = () => {
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const [isVisible, setVisible] = useState(true);
  const [width, setWidth] = useState(SIDE_BAR_WIDTH);
  const storedSidebarStore = useSidebarStore();
  return useMemo(() => {
    if (isReadOnlyPreview) {
      return {
        isVisible,
        setVisible,
        setWidth,
        width,
      };
    }
    return storedSidebarStore;
  }, [isVisible, setVisible, setWidth, width, isReadOnlyPreview, storedSidebarStore]);
};

export const Sidebar: FC<PropsWithChildren<ISidebarProps>> = (props) => {
  const {
    headerLeft,
    headerRight,
    children,
    className,
    mobileTriggerTopOffset,
    temporarilyCollapsed = false,
    onTemporaryExpand,
  } = props;
  const isMobile = useIsMobile();
  // `re-resizable` handles are physical. The sidebar docks to the inline-start
  // edge, so under an RTL interface it sits on the right and the edge the user
  // drags is its LEFT one. Taken from the shared direction context rather than
  // the DOM so server and client render the same handle.
  const isRtl = useUiDirection() === 'rtl';
  const { isVisible, setVisible, setWidth, width } = useSidebar();
  const isHydrated = useIsHydrated();
  const isActuallyVisible = isVisible && !temporarilyCollapsed;
  const toggleSidebar = useCallback(() => {
    if (!isActuallyVisible) {
      onTemporaryExpand?.();
    }
    if (temporarilyCollapsed) {
      return;
    }
    setVisible(!isVisible);
  }, [isActuallyVisible, isVisible, onTemporaryExpand, setVisible, temporarilyCollapsed]);
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
        className="h-full shrink-0 border-e"
        style={{ width: `var(--sidebar-width` }}
        onContextMenu={preventContextMenuUnlessText}
      >
        <div className={sidebarClassName}>{sidebarContent}</div>
      </div>
    );
  }

  // After hydration, safe to check client-only values
  if (isMobile) {
    return (
      <SheetWrapper triggerTopOffset={mobileTriggerTopOffset}>
        <div className={sidebarClassName}>
          <SidebarHeader headerLeft={headerLeft} headerRight={headerRight} />
          {children}
        </div>
      </SheetWrapper>
    );
  }

  // Collapsed state: show trigger button with hover panel
  if (!isActuallyVisible) {
    return (
      <HoverWrapper size={width}>
        <HoverWrapper.Trigger>
          <Button
            className="fixed start-0 z-40 rounded-none rounded-e-full p-1"
            style={{ top: 'calc(var(--teable-top-banner-height) + 1.75rem)' }}
            variant="outline"
            size="xs"
            onClick={toggleSidebar}
            data-sidebar-toggle
          >
            <ChevronsLeft className="size-5 rotate-180" />
          </Button>
        </HoverWrapper.Trigger>
        <HoverWrapper.content>
          <div className={sidebarClassName} onContextMenu={preventContextMenuUnlessText}>
            <SidebarHeader headerLeft={headerLeft} headerRight={headerRight} />
            {children}
          </div>
        </HoverWrapper.content>
      </HoverWrapper>
    );
  }

  return (
    <Resizable
      className="h-full shrink-0 border-e"
      size={{ width, height: '100%' }}
      defaultSize={{ width, height: '100%' }}
      minWidth={MIN_SIDE_BAR_WIDTH}
      maxWidth={MAX_SIDE_BAR_WIDTH}
      enable={isRtl ? { left: true } : { right: true }}
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
      handleClasses={isRtl ? { left: 'group' } : { right: 'group' }}
      handleStyles={
        isRtl
          ? { left: { width: '6px', left: '-6px' } }
          : { right: { width: '6px', right: '-6px' } }
      }
      handleComponent={{
        [isRtl ? 'left' : 'right']: (
          <div className="h-full w-px bg-transparent transition-colors group-hover:bg-primary/50 group-active:bg-primary" />
        ),
      }}
    >
      <div className={sidebarClassName} onContextMenu={preventContextMenuUnlessText}>
        {sidebarContent}
      </div>
    </Resizable>
  );
};
