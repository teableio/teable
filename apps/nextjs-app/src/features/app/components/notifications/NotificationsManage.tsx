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
import classNames from 'classnames';
import React, { useEffect, useState } from 'react';
import { NotificationList } from './NotificationList';

export const NotificationsManage: React.FC = () => {
  const queryClient = useQueryClient();
  const notification = useNotification();

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
          <p>{num} new</p>
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
            <span className="absolute right-2.5 top-1 inline-flex -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-zinc-400 p-[3px] text-[8px] leading-none text-white">
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
            className="relative mb-2 mt-3 max-h-[78vh] overflow-auto"
            notifyStatus={notifyStatus}
            data={notifyPage?.pages}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onShowMoreClick={() => fetchNextPage()}
          />
          {notifyStatus === NotificationStatesEnum.Unread ? (
            <div className="mb-2 mt-4 flex justify-end">
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
                Mark all as read
              </Button>
            </div>
          ) : (
            ''
          )}
          <div className="flex items-center justify-between border-t border-solid p-4">
            <div className="text-sm font-normal">Notifications</div>
            {renderNewButton()}
            <div>
              <Button
                variant="ghost"
                size="xs"
                className={classNames('ml-2', {
                  'bg-secondary': notifyStatus === NotificationStatesEnum.Unread,
                })}
                onClick={() => setNotifyStatus(NotificationStatesEnum.Unread)}
              >
                Unread
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className={classNames('ml-2', {
                  'bg-secondary': notifyStatus === NotificationStatesEnum.Read,
                })}
                onClick={() => setNotifyStatus(NotificationStatesEnum.Read)}
              >
                Read
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
