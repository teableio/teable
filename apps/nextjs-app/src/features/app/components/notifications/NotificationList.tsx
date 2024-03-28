import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationStatesEnum } from '@teable/core';
import { Inbox } from '@teable/icons';
import type { INotificationVo } from '@teable/openapi';
import { updateNotificationStatus } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { Button } from '@teable/ui-lib';
import dayjs, { extend } from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import Link from 'next/link';
import React from 'react';
import { NotificationActionBar } from './NotificationActionBar';
import { NotificationIcon } from './NotificationIcon';

extend(relativeTime);

interface NotificationListProps {
  notifyStatus: NotificationStatesEnum;
  data?: INotificationVo[];
  className?: string;

  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onShowMoreClick?: () => void;
}

export const NotificationList: React.FC<NotificationListProps> = (props) => {
  const { notifyStatus, data, className, hasNextPage, isFetchingNextPage, onShowMoreClick } = props;
  const queryClient = useQueryClient();

  const newPagesArray = (updatedId: string) => {
    return data?.map((item) => ({
      ...item,
      notifications: item.notifications.filter(({ id }) => id !== updatedId),
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

  const renderNotifications = () => {
    return data?.map(({ notifications }) => {
      return (
        notifications &&
        notifications.map(({ id, isRead, url, message, notifyIcon, notifyType, createdTime }) => {
          const fromNow = dayjs(createdTime).fromNow();

          return (
            <NotificationActionBar
              key={id}
              notifyStatus={notifyStatus}
              onStatusCheck={() =>
                updateStatusMutator({
                  notificationId: id,
                  updateNotifyStatusRo: { isRead: !isRead },
                })
              }
            >
              <div className="max-h-[80px]">
                <Link
                  className="flex flex-auto cursor-pointer items-center px-6 py-2 hover:bg-accent"
                  href={url}
                  onClick={async () => {
                    !isRead &&
                      updateStatusMutator({
                        notificationId: id,
                        updateNotifyStatusRo: { isRead: true },
                      });
                  }}
                >
                  <NotificationIcon notifyIcon={notifyIcon} notifyType={notifyType} />
                  <div className="mr-3 w-[calc(100%_-_100px)]  items-center whitespace-pre-wrap break-words text-sm font-normal">
                    <div>{message}</div>
                    <div className="truncate text-[11px] opacity-75" title={fromNow}>
                      {fromNow}
                    </div>
                  </div>
                </Link>
              </div>
            </NotificationActionBar>
          );
        })
      );
    });
  };

  return (
    <div className={className}>
      {!data || !data[0].notifications?.length ? (
        <div className="p-6">
          <div className="flex items-center justify-center text-5xl font-normal">
            <Inbox />
          </div>
          <p className="text-center">No {notifyStatus} notifications</p>
        </div>
      ) : (
        <>
          {renderNotifications()}
          {hasNextPage && (
            <Button
              variant="ghost"
              size={'xs'}
              className="flex w-full p-2 text-center text-[11px] opacity-75"
              onClick={onShowMoreClick}
              disabled={!hasNextPage || isFetchingNextPage}
            >
              Show more
            </Button>
          )}
        </>
      )}
    </div>
  );
};
