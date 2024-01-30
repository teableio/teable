import type {
  INotificationUserIcon,
  INotificationIcon,
  INotificationSystemIcon,
} from '@teable/core';
import { NotificationTypeEnum } from '@teable/core';
import { Avatar, AvatarFallback, AvatarImage } from '@teable/ui-lib';
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
          <Avatar className="size-9">
            <AvatarImage src={iconUrl} alt={'System'} />
            <AvatarFallback>{'System'.slice(0, 1)}</AvatarFallback>
          </Avatar>
        );
      }
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag: {
        const { userAvatarUrl, userName } = notifyIcon as INotificationUserIcon;
        return (
          <Avatar className="size-9">
            <AvatarImage src={userAvatarUrl as string} alt={userName} />
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
