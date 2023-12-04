import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NotificationStatesEnum } from '@teable-group/core';
import { CheckCircle2 as Read, Circle as Unread } from '@teable-group/icons';
import type { INotificationVo } from '@teable-group/openapi';
import { updateNotificationStatus } from '@teable-group/openapi';
import { ReactQueryKeys } from '@teable-group/sdk/config/react-query-keys';
import dayjs, { extend } from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import React from 'react';
import { InteractiveButton } from './InteractiveButton';
import { NotificationIcon } from './NotificationIcon';

extend(relativeTime);

interface NotificationListProps {
  notifyStatus: NotificationStatesEnum;
  data?: INotificationVo[];
}

export const NotificationList: React.FC<NotificationListProps> = (props) => {
  const { notifyStatus, data } = props;
  const queryClient = useQueryClient();

  const newPagesArray = (updatedId: string) => {
    return data?.map(({ notifications, totalCount }) => ({
      notifications: notifications.filter(({ id }) => id !== updatedId),
      totalCount,
    }));
  };

  const { mutateAsync: updateStatusMutator } = useMutation({
    mutationFn: updateNotificationStatus,
    onSuccess: async (_data, variables, _context) => {
      await queryClient.invalidateQueries(ReactQueryKeys.notifyUnreadCount());
      queryClient.setQueryData(
        ReactQueryKeys.notifyList({ status: notifyStatus }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data: any) => ({
          pages: newPagesArray(variables.notificationId),
          pageParams: data.pageParams,
        })
      );
    },
  });

  if (!data || !data[0].notifications?.length) {
    return <div className="p-6 text-center">No {notifyStatus} notifications</div>;
  }

  return data.map(({ notifications }) => {
    return (
      notifications &&
      notifications.map(({ id, isRead, url, message, notifyIcon, notifyType, createdTime }) => {
        const fromNow = dayjs(createdTime).fromNow();

        return (
          <div key={id} className="max-h-[80px]">
            <a
              className="flex flex-auto cursor-pointer items-center px-6 py-2 hover:bg-accent"
              href={url}
            >
              <NotificationIcon notifyIcon={notifyIcon} notifyType={notifyType} />
              <div className="mr-3 flex-auto items-center whitespace-pre-wrap break-words text-sm font-normal">
                <div>{message}</div>
                <div className="truncate text-[11px] opacity-75" title={fromNow}>
                  {fromNow}
                </div>
              </div>
              <InteractiveButton
                defaultIcon={notifyStatus === NotificationStatesEnum.Unread ? <Unread /> : <Read />}
                hoverIcon={notifyStatus === NotificationStatesEnum.Unread ? <Read /> : <Unread />}
                variant="ghost"
                size="xs"
                className="text-sm font-normal"
                onClick={() => {
                  updateStatusMutator({
                    notificationId: id,
                    updateNotifyStatusRo: { isRead: !isRead },
                  });
                }}
              />
            </a>
          </div>
        );
      })
    );
  });
};
