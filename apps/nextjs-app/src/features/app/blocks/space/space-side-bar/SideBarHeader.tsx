import { TeableNew, Sidebar } from '@teable/icons';
import { Button, TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@teable/ui-lib';
import type { ISideBarInteractionProps } from '../../../blocks/base/base-side-bar/SideBar';

export const SideBarHeader = (prop: ISideBarInteractionProps) => {
  const { expandSideBar } = prop;

  return (
    <div className="m-2 flex items-center gap-1">
      <TeableNew className="size-6 shrink-0 text-black" />
      <p className="truncate text-sm">Teable</p>
      <div className="grow basis-0"></div>
      {expandSideBar && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="w-6 shrink-0 px-0"
                variant="ghost"
                size="xs"
                onClick={() => expandSideBar?.()}
              >
                <Sidebar className="size-4"></Sidebar>
              </Button>
            </TooltipTrigger>
            <TooltipContent hideWhenDetached={true}>
              <p>Collapse SideBar ⌘+B</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};
