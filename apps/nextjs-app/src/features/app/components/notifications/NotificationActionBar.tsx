import { NotificationStatesEnum } from '@teable/core';
import { CheckSquare, MarkUnread } from '@teable/icons';
import {
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import React from 'react';

interface ActionBarProps {
  notifyStatus: NotificationStatesEnum;
  onStatusCheck?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
  commonHandler: () => Promise<void>;
}

export const NotificationActionBar: React.FC<ActionBarProps> = (props) => {
  const { notifyStatus, children, onStatusCheck, commonHandler } = props;
  const { t } = useTranslation('common');

  return (
    <HoverCard openDelay={100} closeDelay={0}>
      <HoverCardTrigger
        onClick={async () => {
          await commonHandler();
        }}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        className="size-auto p-0"
        sideOffset={-35}
        alignOffset={16}
        side="top"
        align="end"
      >
        <div className="flex p-0.5">
          <div className="inline-flex size-6 cursor-pointer items-center justify-center rounded hover:bg-secondary">
            <TooltipProvider>
              <Tooltip delayDuration={20}>
                <TooltipTrigger asChild>
                  <Button
                    className="size-full p-0"
                    variant="ghost"
                    onClick={(e) => onStatusCheck?.(e)}
                  >
                    {notifyStatus === NotificationStatesEnum.Unread ? (
                      <CheckSquare className="text-sm" />
                    ) : (
                      <MarkUnread />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" sideOffset={10}>
                  {t('notification.markAs', {
                    status:
                      notifyStatus === NotificationStatesEnum.Unread
                        ? t('notification.read')
                        : t('notification.unread'),
                  })}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {/* <div className="inline-flex size-6 cursor-pointer items-center justify-center rounded hover:bg-secondary">
            <TooltipProvider>
              <Tooltip delayDuration={20}>
                <TooltipTrigger asChild>
                  <Button className="size-full p-0" variant="ghost">
                    <MoreHorizontal />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" sideOffset={10}>
                  {t('notification.changeSetting')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div> */}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
