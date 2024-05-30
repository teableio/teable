import { ChevronsLeft } from '@teable/icons';
import { useIsMobile } from '@teable/sdk';
import { Button, cn } from '@teable/ui-lib';
import { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { SideBarFooter } from '@/features/app/components/SideBarFooter';
import type { ISideBarInteractionProps } from '../../../blocks/base/base-side-bar/SideBar';
import { SIDEBARWIDTH } from '../../../components/toggle-side-bar/constant';
import { HoverWraper } from '../../../components/toggle-side-bar/HoverWraper';
import { SheetWrapper } from '../../../components/toggle-side-bar/SheetWrapper';
import { SideBarHeader } from './SideBarHeader';
import { SpaceSideBar } from './SpaceSideBar';

const SiderContent = (props: ISideBarInteractionProps) => {
  return (
    <div className="flex size-full flex-col overflow-hidden bg-popover">
      <SideBarHeader {...props} />
      <div className="flex flex-1 flex-col gap-2 divide-y divide-solid overflow-hidden py-2">
        <SpaceSideBar />
      </div>
      <SideBarFooter />
    </div>
  );
};

export const SideBar = () => {
  const isMobile = useIsMobile();
  const [leftVisible, setLeftVisible] = useState(true);

  useHotkeys(`meta+b`, () => {
    setLeftVisible(!leftVisible);
  });

  return (
    <>
      {isMobile ? (
        <SheetWrapper>
          <SiderContent />
        </SheetWrapper>
      ) : (
        <div
          className={cn('transition-all flex w-0 border-r will-change-auto flex-shrink-0 h-full', {
            'overflow-hidden': !leftVisible,
          })}
          style={{
            width: leftVisible ? `${SIDEBARWIDTH}px` : '',
          }}
        >
          <SiderContent expandSideBar={() => setLeftVisible(!leftVisible)} />
        </div>
      )}

      {!isMobile && !leftVisible && (
        <HoverWraper size={SIDEBARWIDTH}>
          <HoverWraper.Trigger>
            <Button
              className={cn('absolute top-7 p-1 rounded-none -left-0 rounded-r-full z-[51]')}
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
            <SiderContent></SiderContent>
          </HoverWraper.content>
        </HoverWraper>
      )}
    </>
  );
};
