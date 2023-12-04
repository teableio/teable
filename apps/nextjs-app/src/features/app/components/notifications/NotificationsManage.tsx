import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NotificationStatesEnum } from '@teable-group/core';
import { Bell, CheckCircle2 as Read } from '@teable-group/icons';
import {
  getNotificationList,
  getNotificationUnreadCount,
  notificationReadAll,
} from '@teable-group/openapi';
import { useNotification } from '@teable-group/sdk';
import { ReactQueryKeys } from '@teable-group/sdk/config/react-query-keys';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useEffect, useState } from 'react';
import { NotificationList } from './NotificationList';

export const NotificationsManage: React.FC = () => {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifyStatus, setNotifyStatus] = useState(NotificationStatesEnum.Unread);

  const queryClient = useQueryClient();
  const notification = useNotification();

  console.log('notification ', notification);

  const { data: queryUnreadCount = 0 } = useQuery({
    queryKey: ReactQueryKeys.notifyUnreadCount(),
    queryFn: () => getNotificationUnreadCount().then(({ data }) => data.unreadCount),
  });

  useEffect(() => {
    setUnreadCount(notification?.unreadCount ?? queryUnreadCount);
  }, [notification?.unreadCount, queryUnreadCount]);

  const {
    data: notifyPage,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ReactQueryKeys.notifyList({ status: notifyStatus }),
    queryFn: ({ pageParam = 0 }) =>
      getNotificationList({ notifyStates: notifyStatus, offset: pageParam }).then(
        ({ data }) => data
      ),
    getNextPageParam: (lastPage, allPages) => {
      console.log('allPages,', allPages);
      const nextOffset = allPages.length * 5;
      return nextOffset < lastPage.totalCount ? nextOffset : undefined;
    },
  });

  const { mutateAsync: markAllAsReadMutator } = useMutation({
    mutationFn: notificationReadAll,
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.notifyUnreadCount());
      refresh();
    },
  });

  const refresh = () => {
    queryClient.resetQueries(ReactQueryKeys.notifyList({ status: notifyStatus }), { exact: true });
  };
  return (
    <Popover>
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
          <Bell className="h-5 w-5 shrink-0" />
          {unreadCount > 0 ? (
            <span className="absolute right-2.5 top-1 inline-flex -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-zinc-400 p-[3px] text-[8px] leading-none text-white">
              {unreadCount}
            </span>
          ) : (
            ''
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="left" align="end" sideOffset={10} className="min-w-[400px] p-0">
        <div className="w-full">
          <div className="m-2 flex items-center justify-between border-b border-solid pb-4">
            <div className="text-sm font-normal">Notifications</div>
            <div>
              <Button
                variant="ghost"
                size="xs"
                className={classNames('mr-2', {
                  'bg-secondary': notifyStatus === NotificationStatesEnum.Unread,
                })}
                onClick={() => setNotifyStatus(NotificationStatesEnum.Unread)}
              >
                Unread
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className={classNames('mr-2', {
                  'bg-secondary': notifyStatus === NotificationStatesEnum.Read,
                })}
                onClick={() => setNotifyStatus(NotificationStatesEnum.Read)}
              >
                Read
              </Button>
            </div>
          </div>
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
                Read all
              </Button>
            </div>
          ) : (
            ''
          )}
          <div className="relative mb-3 mt-2 max-h-[744px] overflow-auto">
            <NotificationList notifyStatus={notifyStatus} data={notifyPage?.pages} />
            {hasNextPage && (
              <Button
                variant="ghost"
                size={'xs'}
                className="flex w-full p-2 text-center text-[11px] opacity-75"
                onClick={() => fetchNextPage()}
                disabled={!hasNextPage || isFetchingNextPage}
              >
                Show more
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
