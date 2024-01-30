import { NotificationStatesEnum } from '@teable/core';
import { CheckSquare, MarkUnread, MoreHorizontal } from '@teable/icons';
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
import React from 'react';

interface ActionBarProps {
  notifyStatus: NotificationStatesEnum;
  onStatusCheck?: () => void;
  children: React.ReactNode;
}

export const NotificationActionBar: React.FC<ActionBarProps> = (props) => {
  const { notifyStatus, children, onStatusCheck } = props;

  return (
    <HoverCard openDelay={100} closeDelay={0}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
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
                  <Button className="size-full p-0" variant="ghost" onClick={onStatusCheck}>
                    {notifyStatus === NotificationStatesEnum.Unread ? (
                      <CheckSquare className="text-sm" />
                    ) : (
                      <MarkUnread />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" sideOffset={10}>
                  Mark this notification as
                  {notifyStatus === NotificationStatesEnum.Unread ? ' read' : ' unread'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="inline-flex size-6 cursor-pointer items-center justify-center rounded hover:bg-secondary">
            <TooltipProvider>
              <Tooltip delayDuration={20}>
                <TooltipTrigger asChild>
                  <Button className="size-full p-0" variant="ghost">
                    <MoreHorizontal />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" sideOffset={10}>
                  Change page notification settings
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
