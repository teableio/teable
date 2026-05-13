import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NotificationStatesEnum } from '@teable/core';
import { Inbox } from '@teable/icons';
import type { INotificationVo } from '@teable/openapi';
import { updateNotificationStatus } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { Button } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import React, { useMemo } from 'react';
import { NotificationActionBar } from './NotificationActionBar';
import { NotificationItem } from './NotificationItem';

interface NotificationListProps {
  notifyStatus: NotificationStatesEnum;
  data?: INotificationVo[];
  className?: string;

  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onShowMoreClick?: () => void;
  emptyMessage?: string;
}

export const NotificationList: React.FC<NotificationListProps> = (props) => {
  const {
    notifyStatus,
    data,
    className,
    hasNextPage,
    isFetchingNextPage,
    onShowMoreClick,
    emptyMessage,
  } = props;
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const notifications = useMemo(() => data?.flatMap((page) => page.notifications) ?? [], [data]);

  const { mutateAsync: updateStatusMutator } = useMutation({
    mutationFn: updateNotificationStatus,
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyUnreadCount() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyList() });
    },
  });

  const commonHandler = async (notificationId: string, isRead: boolean) => {
    if (isRead) {
      await updateStatusMutator({
        notificationId,
        updateNotifyStatusRo: { isRead },
      });
    }
  };

  return (
    <div className={className}>
      {!notifications.length ? (
        <div className="p-6">
          <div className="flex items-center justify-center text-5xl font-normal">
            <Inbox />
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {emptyMessage ??
              t('notification.noUnread', {
                status:
                  notifyStatus === NotificationStatesEnum.Read
                    ? t('notification.read')
                    : t('notification.unread'),
              })}
          </p>
        </div>
      ) : (
        <>
          <section>
            {notifications.map((notification) => {
              const { id, isRead } = notification;
              return (
                <NotificationActionBar
                  key={id}
                  notifyStatus={notifyStatus}
                  onStatusCheck={(e) => {
                    e.stopPropagation();
                    updateStatusMutator({
                      notificationId: id,
                      updateNotifyStatusRo: { isRead: !isRead },
                    });
                  }}
                  commonHandler={() => commonHandler(id, !isRead)}
                >
                  <NotificationItem data={notification} notifyStatus={notifyStatus} />
                </NotificationActionBar>
              );
            })}
          </section>
          {hasNextPage && (
            <Button
              variant="ghost"
              size={'xs'}
              className="flex w-full p-2 text-center text-[11px] opacity-75"
              onClick={onShowMoreClick}
              disabled={!hasNextPage || isFetchingNextPage}
            >
              {t('notification.showMore')}
            </Button>
          )}
        </>
      )}
    </div>
  );
};
