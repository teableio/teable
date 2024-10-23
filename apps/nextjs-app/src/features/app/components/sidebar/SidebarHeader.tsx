import { Sidebar } from '@teable/icons';
import { Button, TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';

export interface ISidebarHeaderProps {
  headerLeft: ReactNode;
  onExpand?: () => void;
}

export const SidebarHeader = (prop: ISidebarHeaderProps) => {
  const { headerLeft, onExpand } = prop;
  const { t } = useTranslation('common');

  return (
    <div className="flex h-10 w-full items-center gap-1 p-2">
      {headerLeft}
      {onExpand && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="ml-auto mr-0 w-6 shrink-0 px-0"
                variant="ghost"
                size="xs"
                onClick={() => onExpand?.()}
              >
                <Sidebar className="size-4"></Sidebar>
              </Button>
            </TooltipTrigger>
            <TooltipContent hideWhenDetached={true}>
              <p>{t('actions.collapseSidebar')} ⌘+B</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};
