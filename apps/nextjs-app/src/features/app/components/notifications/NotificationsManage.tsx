import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { INotificationIcon } from '@teable/core';
import { NotificationStatesEnum, NotificationTypeEnum } from '@teable/core';
import { Bell, CheckCircle2 as Read, Download, RefreshCcw } from '@teable/icons';
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
import type { TFunction } from 'next-i18next';
import React, { useEffect, useState } from 'react';
import { LinkNotification } from './notification-component';
import { NotificationIcon } from './NotificationIcon';
import { NotificationList } from './NotificationList';

const SHOWN_NOTIFICATIONS_LIMIT = 100;
const shownNotificationIds = new Set<string>();

const showExportBaseToast = (
  notification: {
    url?: string | null;
    messageI18n?: string | null;
    notifyIcon: INotificationIcon;
    notifyType: NotificationTypeEnum;
  },
  toastId: string,
  t: TFunction
) => {
  const { url, messageI18n } = notification;
  let fileName = '';
  let downloadUrl = url || '';
  let isSuccess = true;
  try {
    const parsed = JSON.parse(messageI18n || '{}');
    fileName = parsed?.context?.name || parsed?.context?.baseName || '';
    isSuccess = !parsed?.i18nKey?.includes('failed');
    if (!downloadUrl) {
      downloadUrl = parsed?.context?.previewUrl || '';
    }
  } catch {
    // ignore
  }

  const toastFn = isSuccess ? toast : toast.error;
  const titleKey = isSuccess
    ? 'notification.exportBase.successText'
    : 'notification.exportBase.failedText';
  toastFn(
    <div className="flex w-full items-center gap-2">
      <NotificationIcon notifyIcon={notification.notifyIcon} notifyType={notification.notifyType} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="truncate text-sm font-medium">{t(titleKey)}</div>
        {fileName && <div className="truncate text-xs text-muted-foreground">{fileName}</div>}
      </div>
      {isSuccess && downloadUrl && (
        <a href={downloadUrl} download className="ml-auto">
          <Button variant="default" size="xs" className="shrink-0 gap-1">
            <Download className="size-4" />
            {t('actions.download')}
          </Button>
        </a>
      )}
    </div>,
    {
      id: toastId,
      position: 'top-center',
      duration: 1000 * 3,
      closeButton: !isSuccess,
    }
  );
};

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

    const notificationId = notification.notification.id;
    if (shownNotificationIds.has(notificationId)) return;
    if (shownNotificationIds.size >= SHOWN_NOTIFICATIONS_LIMIT) {
      shownNotificationIds.clear();
    }
    shownNotificationIds.add(notificationId);

    const isCreditNotification =
      notification.notification.messageI18n?.includes('creditExhausted') ||
      notification.notification.messageI18n?.includes('insufficientCredit');
    const toastId = isCreditNotification ? 'credit-exhausted-notification' : notificationId;

    if (notification.notification.notifyType === NotificationTypeEnum.ExportBase) {
      // Dispatch event for export dialog to listen
      // If dialog handles it (preventDefault), skip the toast
      const { messageI18n, url } = notification.notification;
      let handledByDialog = false;
      try {
        const parsed = JSON.parse(messageI18n || '{}');
        const baseName = parsed?.context?.baseName || '';
        const fileName = parsed?.context?.name || baseName;
        const downloadUrl = url || parsed?.context?.previewUrl || '';
        const isSuccess = !parsed?.i18nKey?.includes('failed');
        const event = new CustomEvent('export-base-complete', {
          cancelable: true,
          detail: { downloadUrl, fileName, baseName, isSuccess },
        });
        window.dispatchEvent(event);
        handledByDialog = event.defaultPrevented;
      } catch {
        // ignore parse error
      }
      if (!handledByDialog) {
        showExportBaseToast(notification.notification, toastId, t);
      }
    } else {
      toast.info(
        <div className="flex items-center">
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
          id: toastId,
          position: 'top-center',
          duration: 1000 * 3,
          closeButton: true,
        }
      );
    }
  }, [notification?.notification, t]);

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
    initialPageParam: undefined as string | undefined,
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
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyUnreadCount() });
    queryClient.resetQueries({
      queryKey: ReactQueryKeys.notifyList({ status: notifyStatus }),
      exact: true,
    });
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
          <RefreshCcw className="size-4 shrink-0" />
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
          className="relative "
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
          <div className="flex items-center justify-between border-b border-border-high p-4">
            <div className="text-base font-semibold">{t('notification.title')}</div>
            {renderNewButton()}
            <div>
              <Button
                variant="ghost"
                size="xs"
                className={cn('ml-2', {
                  'bg-accent': notifyStatus === NotificationStatesEnum.Unread,
                })}
                onClick={() => setNotifyStatus(NotificationStatesEnum.Unread)}
              >
                {t('notification.title')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className={cn('ml-2', {
                  'bg-accent': notifyStatus === NotificationStatesEnum.Read,
                })}
                onClick={() => setNotifyStatus(NotificationStatesEnum.Read)}
              >
                {t('notification.read')}
              </Button>
            </div>
          </div>
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
        </div>
      </PopoverContent>
    </Popover>
  );
};
