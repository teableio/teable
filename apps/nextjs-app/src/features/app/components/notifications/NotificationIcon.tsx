import type {
  INotificationCollaboratorCellTagIcon,
  INotificationIcon,
  INotificationSystemIcon,
} from '@teable-group/core';
import { NotificationTypeEnum } from '@teable-group/core';
import { Avatar, AvatarFallback, AvatarImage } from '@teable-group/ui-lib';
import React, { useCallback } from 'react';

interface NotificationIconProps {
  notifyIcon: INotificationIcon;
  notifyType: NotificationTypeEnum;
}

const NotificationIcon = (props: NotificationIconProps) => {
  const { notifyIcon, notifyType } = props;

  const dynamicComponent = useCallback(() => {
    switch (notifyType) {
      case NotificationTypeEnum.System: {
        const { iconUrl } = notifyIcon as INotificationSystemIcon;
        return (
          <Avatar className="h-9 w-9">
            <AvatarImage src={iconUrl} alt={'System'} />
            <AvatarFallback>{'System'.slice(0, 1)}</AvatarFallback>
          </Avatar>
        );
      }
      case NotificationTypeEnum.CollaboratorCellTag: {
        const { userAvatarUrl, userName } = notifyIcon as INotificationCollaboratorCellTagIcon;
        return (
          <Avatar className="h-9 w-9">
            <AvatarImage src={userAvatarUrl} alt={userName} />
            <AvatarFallback>{userName.slice(0, 1)}</AvatarFallback>
          </Avatar>
        );
      }
    }
  }, [notifyIcon, notifyType]);
  return (
    <div className="relative flex flex-none items-center self-start pr-2">{dynamicComponent()}</div>
  );
};

export { NotificationIcon };
