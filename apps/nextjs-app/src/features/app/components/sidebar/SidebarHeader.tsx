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
    <div className="m-2 flex h-7 items-center gap-1">
      {headerLeft}
      <div className="grow basis-0" />
      {onExpand && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="w-6 shrink-0 px-0"
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
