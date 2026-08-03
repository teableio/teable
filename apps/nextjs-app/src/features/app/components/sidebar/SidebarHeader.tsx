import { Sidebar } from '@teable/icons';
import { Button, TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useModKeyStr } from '@/features/app/utils/get-mod-key-str';
export interface ISidebarHeaderProps {
  headerLeft: ReactNode;
  headerRight?: ReactNode;
  onExpand?: () => void;
}

export const SidebarHeader = (props: ISidebarHeaderProps) => {
  const { headerLeft, headerRight, onExpand } = props;
  const modKeyStr = useModKeyStr();
  const { t } = useTranslation(['common']);
  return (
    <div className="flex w-full items-center gap-2 py-2 pl-4 pr-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">{headerLeft}</div>
      <div className="flex shrink-0 items-center gap-1">
        {headerRight}
        {onExpand && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="size-7 shrink-0 p-0"
                  variant="ghost"
                  size="xs"
                  onClick={onExpand}
                >
                  <Sidebar className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent hideWhenDetached={true}>
                {t('common:actions.collapseSidebar')}
                <span>{modKeyStr}+B</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
};
