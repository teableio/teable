import type {
  INotificationUserIcon,
  INotificationIcon,
  INotificationSystemIcon,
} from '@teable/core';
import { NotificationTypeEnum } from '@teable/core';
import { Avatar, AvatarFallback, AvatarImage } from '@teable/ui-lib';
import Image from 'next/image';
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
            <AvatarImage asChild src={iconUrl as string}>
              <Image src={iconUrl as string} alt={'System'} width={28} height={28} />
            </AvatarImage>
            <AvatarFallback>{'System'.slice(0, 1)}</AvatarFallback>
          </Avatar>
        );
      }
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag: {
        const { userAvatarUrl, userName } = notifyIcon as INotificationUserIcon;
        return (
          <Avatar className="size-9">
            <AvatarImage asChild src={userAvatarUrl as string}>
              <Image src={userAvatarUrl as string} alt={userName} width={28} height={28} />
            </AvatarImage>
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
