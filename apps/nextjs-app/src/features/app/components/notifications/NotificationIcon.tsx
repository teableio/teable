import type {
  INotificationIcon,
  INotificationSystemIcon,
  INotificationUserIcon,
} from '@teable/core';
import { NotificationTypeEnum } from '@teable/core';
import { Avatar, AvatarFallback, AvatarImage } from '@teable/ui-lib';
import React, { useCallback } from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';

interface NotificationIconProps {
  notifyIcon: INotificationIcon;
  notifyType: NotificationTypeEnum;
}

const NotificationIcon = (props: NotificationIconProps) => {
  const { notifyIcon, notifyType } = props;

  const dynamicComponent = useCallback(() => {
    switch (notifyType) {
      case NotificationTypeEnum.ExportBase:
      case NotificationTypeEnum.System: {
        const { iconUrl } = notifyIcon as INotificationSystemIcon;

        return (
          <Avatar className="size-9 overflow-visible">
            {iconUrl && <AvatarImage src={iconUrl} alt="System" />}
            <AvatarFallback>{'System'.slice(0, 1)}</AvatarFallback>
          </Avatar>
        );
      }
      case NotificationTypeEnum.Comment:
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag: {
        const { userAvatarUrl, userName } = notifyIcon as INotificationUserIcon;
        return <UserAvatar className="size-9" user={{ name: userName, avatar: userAvatarUrl }} />;
      }
    }
  }, [notifyIcon, notifyType]);
  return (
    <div className="relative flex flex-none items-center self-start pr-2">{dynamicComponent()}</div>
  );
};

export { NotificationIcon };
