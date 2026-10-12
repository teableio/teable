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

const IconAvatar = ({ iconUrl, label }: { iconUrl?: string; label: string }) => (
  <Avatar className="size-9 overflow-visible">
    {iconUrl && <AvatarImage src={iconUrl} alt={label} />}
    <AvatarFallback>{label.slice(0, 1)}</AvatarFallback>
  </Avatar>
);

const NotificationIcon = (props: NotificationIconProps) => {
  const { notifyIcon, notifyType } = props;

  const dynamicComponent = useCallback(() => {
    switch (notifyType) {
      case NotificationTypeEnum.ExportBase:
      case NotificationTypeEnum.System:
      case NotificationTypeEnum.AdminNotice: {
        const { iconUrl } = notifyIcon as INotificationSystemIcon;
        return <IconAvatar iconUrl={iconUrl} label="System" />;
      }
      case NotificationTypeEnum.OAuthApp: {
        // the logo the sending app registered
        const { iconUrl } = notifyIcon as INotificationSystemIcon;
        return <IconAvatar iconUrl={iconUrl} label="App" />;
      }
      case NotificationTypeEnum.Comment:
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag:
      case NotificationTypeEnum.CollaboratorInvite: {
        const { userAvatarUrl, userName } = notifyIcon as INotificationUserIcon;
        return <UserAvatar className="size-9" user={{ name: userName, avatar: userAvatarUrl }} />;
      }
      default: {
        // A type newer than this build: draw whichever icon shape it came with.
        if ('userName' in notifyIcon) {
          return (
            <UserAvatar
              className="size-9"
              user={{ name: notifyIcon.userName, avatar: notifyIcon.userAvatarUrl }}
            />
          );
        }
        return <IconAvatar iconUrl={notifyIcon.iconUrl} label="System" />;
      }
    }
  }, [notifyIcon, notifyType]);
  return (
    <div className="relative flex flex-none items-center self-start pe-2">{dynamicComponent()}</div>
  );
};

export { NotificationIcon };
