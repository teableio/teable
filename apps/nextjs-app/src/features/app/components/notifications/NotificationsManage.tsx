import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NotificationStatesEnum } from '@teable/core';
import { Bell, CheckCircle2 as Read, RefreshCcw } from '@teable/icons';
import {
  getNotificationList,
  getNotificationUnreadCount,
  notificationReadAll,
} from '@teable/openapi';
import { useNotification } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { cn } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import React, { useEffect, useState } from 'react';
import { LinkNotification } from './notification-component';
import { NotificationIcon } from './NotificationIcon';
import { NotificationList } from './NotificationList';

export const NotificationsManage: React.FC = () => {
  const queryClient = useQueryClient();
  const notification = useNotification();
  const { t } = useTranslation('common');

  const [isOpen, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const [newUnreadCount, setNewUnreadCount] = useState<number | undefined>(undefined);

  const [notifyStatus, setNotifyStatus] = useState(NotificationStatesEnum.Unread);

  const { data: queryUnreadCount = 0 } = useQuery({
    queryKey: ReactQueryKeys.notifyUnreadCount(),
    queryFn: () => getNotificationUnreadCount().then(({ data }) => data.unreadCount),
  });

  useEffect(() => {
    if (notification?.unreadCount == null) return;

    setNewUnreadCount(notification.unreadCount);
  }, [notification?.unreadCount]);

  useEffect(() => {
    setUnreadCount(newUnreadCount ?? queryUnreadCount);
  }, [newUnreadCount, queryUnreadCount]);

  useEffect(() => {
    if (notification?.notification == null) return;
    if (notification.notification.isRead) return;

    toast.info(
      <div className="flex  items-center">
        <NotificationIcon
          notifyIcon={notification.notification.notifyIcon}
          notifyType={notification.notification.notifyType}
        />
        <LinkNotification
          data={notification.notification}
          notifyStatus={NotificationStatesEnum.Unread}
        />
      </div>,
      {
        position: 'top-center',
        duration: 1000 * 3,
        closeButton: true,
      }
    );
  }, [notification?.notification]);

  const {
    data: notifyPage,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ReactQueryKeys.notifyList({ status: notifyStatus }),
    queryFn: ({ pageParam }) =>
      getNotificationList({ notifyStates: notifyStatus, cursor: pageParam }).then(
        ({ data }) => data
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: isOpen,
    staleTime: 0,
  });

  const { mutateAsync: markAllAsReadMutator } = useMutation({
    mutationFn: notificationReadAll,
    onSuccess: () => {
      refresh();
    },
  });

  const refresh = () => {
    setNewUnreadCount(undefined);
    queryClient.invalidateQueries(ReactQueryKeys.notifyUnreadCount());
    queryClient.resetQueries(ReactQueryKeys.notifyList({ status: notifyStatus }), { exact: true });
  };

  const renderNewButton = () => {
    if (!newUnreadCount) return;

    const num = newUnreadCount - queryUnreadCount;

    if (num < 1) return;
    return (
      <div>
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            refresh();
          }}
        >
          <RefreshCcw />
          <p>{t('notification.new', { count: num })}</p>
        </Button>
      </div>
    );
  };

  return (
    <Popover onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={'xs'}
          className="relative"
          onClick={() => {
            setNotifyStatus(NotificationStatesEnum.Unread);
            refresh();
          }}
        >
          <Bell className="size-5 shrink-0" />
          {unreadCount > 0 ? (
            <span className="absolute right-2.5 top-1 inline-flex -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-red-400 p-1 text-[8px] leading-none text-white">
              {unreadCount}
            </span>
          ) : (
            ''
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="left" align="end" className="min-w-[500px] p-0">
        <div className="w-full">
          <NotificationList
            className="relative max-h-[78vh] overflow-auto"
            notifyStatus={notifyStatus}
            data={notifyPage?.pages}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onShowMoreClick={() => fetchNextPage()}
          />
          {notifyStatus === NotificationStatesEnum.Unread ? (
            <div className="my-1.5 flex justify-end">
              <Button
                variant="ghost"
                size="xs"
                className="mr-2"
                disabled={unreadCount < 1}
                onClick={() => {
                  markAllAsReadMutator();
                }}
              >
                <Read />
                {t('notification.markAllAsRead')}
              </Button>
            </div>
          ) : (
            ''
          )}
          <div className="flex items-center justify-between border-t border-solid p-4">
            <div className="text-sm font-normal">{t('notification.title')}</div>
            {renderNewButton()}
            <div>
              <Button
                variant="ghost"
                size="xs"
                className={cn('ml-2', {
                  'bg-secondary': notifyStatus === NotificationStatesEnum.Unread,
                })}
                onClick={() => setNotifyStatus(NotificationStatesEnum.Unread)}
              >
                {t('notification.title')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className={cn('ml-2', {
                  'bg-secondary': notifyStatus === NotificationStatesEnum.Read,
                })}
                onClick={() => setNotifyStatus(NotificationStatesEnum.Read)}
              >
                {t('notification.read')}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
