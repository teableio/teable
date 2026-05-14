import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { INotification, INotificationIcon } from '@teable/core';
import {
  NotificationSeverityEnum,
  NotificationStatesEnum,
  NotificationTypeEnum,
} from '@teable/core';
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
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import type { TFunction } from 'next-i18next';
import React, { useEffect, useState } from 'react';
import { useLocalStorage } from 'react-use';
import { LinkNotification } from './notification-component';
import { NotificationIcon } from './NotificationIcon';
import { NotificationList } from './NotificationList';

const SHOWN_NOTIFICATIONS_LIMIT = 100;
const TOAST_AUTO_CLOSE_DURATION = 1000 * 3;
const TOAST_MANUAL_CLOSE_DURATION = Infinity;
const shownNotificationIds = new Set<string>();
const NOTIFICATION_SEVERITY_FILTER_KEY = 'teable:notification:severity-filter';
const CREDIT_EXHAUSTED_NOTIFICATION_TOAST_ID = 'credit-exhausted-notification';
const CREDIT_NOTIFICATION_I18N_KEYS = new Set([
  'email.templates.notify.task.ai.cancelled.creditExhausted',
  'email.templates.notify.automation.insufficientCredit.title',
]);
const NOTIFICATION_SEVERITIES = [
  NotificationSeverityEnum.Critical,
  NotificationSeverityEnum.Warning,
  NotificationSeverityEnum.Info,
] as const;

const isNotificationSeverity = (value: unknown): value is NotificationSeverityEnum =>
  NOTIFICATION_SEVERITIES.includes(value as NotificationSeverityEnum);

const getNotificationToastDuration = (notification: Pick<INotification, 'severity'>) =>
  notification.severity === NotificationSeverityEnum.Critical
    ? TOAST_MANUAL_CLOSE_DURATION
    : TOAST_AUTO_CLOSE_DURATION;

const getNotificationToastId = (notification: INotification) => {
  let i18nKey: string | undefined;
  try {
    const parsed = JSON.parse(notification.messageI18n || '{}');
    i18nKey = typeof parsed?.i18nKey === 'string' ? parsed.i18nKey : undefined;
  } catch {
    // ignore invalid messageI18n
  }

  return i18nKey && CREDIT_NOTIFICATION_I18N_KEYS.has(i18nKey)
    ? `${dayjs().format('YYYY-MM-DD')}-${CREDIT_EXHAUSTED_NOTIFICATION_TOAST_ID}`
    : notification.id;
};

const dispatchExportBaseComplete = (notification: Pick<INotification, 'messageI18n' | 'url'>) => {
  const { messageI18n, url } = notification;

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
    return event.defaultPrevented;
  } catch {
    return false;
  }
};

const showExportBaseToast = (
  notification: INotification & { notifyIcon: INotificationIcon },
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
      duration: getNotificationToastDuration(notification),
      closeButton: true,
    }
  );
};

const showGeneralNotificationToast = (notification: INotification, toastId: string) => {
  toast.info(
    <div className="flex items-center">
      <NotificationIcon notifyIcon={notification.notifyIcon} notifyType={notification.notifyType} />
      <LinkNotification data={notification} notifyStatus={NotificationStatesEnum.Unread} />
    </div>,
    {
      id: toastId,
      position: 'top-center',
      duration: getNotificationToastDuration(notification),
      closeButton: true,
    }
  );
};

const showNotificationToast = (notification: INotification, toastId: string, t: TFunction) => {
  if (notification.notifyType === NotificationTypeEnum.ExportBase) {
    if (!dispatchExportBaseComplete(notification)) {
      showExportBaseToast(notification, toastId, t);
    }
    return;
  }

  showGeneralNotificationToast(notification, toastId);
};

export const NotificationsManage: React.FC = () => {
  const queryClient = useQueryClient();
  const notification = useNotification();
  const { t } = useTranslation('common');

  const [isOpen, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const [newUnreadCount, setNewUnreadCount] = useState<number | undefined>(undefined);

  const [notifyStatus, setNotifyStatus] = useState(NotificationStatesEnum.Unread);
  const [storedSeverity, setStoredSeverity, removeStoredSeverity] =
    useLocalStorage<NotificationSeverityEnum>(NOTIFICATION_SEVERITY_FILTER_KEY, undefined, {
      raw: true,
    });
  const selectedSeverity = isNotificationSeverity(storedSeverity) ? storedSeverity : undefined;

  useEffect(() => {
    if (storedSeverity && !isNotificationSeverity(storedSeverity)) {
      removeStoredSeverity();
    }
  }, [removeStoredSeverity, storedSeverity]);

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

    showNotificationToast(
      notification.notification,
      getNotificationToastId(notification.notification),
      t
    );
  }, [notification?.notification, t]);

  const {
    data: notifyPage,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ReactQueryKeys.notifyList({ status: notifyStatus, severity: selectedSeverity }),
    queryFn: ({ pageParam }) =>
      getNotificationList({
        notifyStates: notifyStatus,
        severity: selectedSeverity,
        cursor: pageParam,
      }).then(({ data }) => data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: isOpen,
    staleTime: 0,
  });

  const { mutateAsync: markAllAsReadMutator } = useMutation({
    mutationFn: notificationReadAll,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyList() });
      refresh();
    },
  });

  const refresh = () => {
    setNewUnreadCount(undefined);
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyUnreadCount() });
    queryClient.resetQueries({ queryKey: ReactQueryKeys.notifyList() });
  };

  const notifySummary = notifyPage?.pages[0]?.summary;

  const getSeverityLabel = (severity: NotificationSeverityEnum) =>
    t(`notification.severity.${severity}`);

  const handleSeverityClick = (severity: NotificationSeverityEnum) => {
    if (selectedSeverity === severity) {
      removeStoredSeverity();
      return;
    }

    setStoredSeverity(severity);
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
                {t('notification.unread')}
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
          <div className="flex gap-1.5 px-4 py-2.5">
            {NOTIFICATION_SEVERITIES.map((severity) => {
              const isSelected = selectedSeverity === severity;

              return (
                <Button
                  key={severity}
                  variant="ghost"
                  size="xs"
                  className={cn(
                    'h-7 gap-1.5 rounded px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                    isSelected && 'bg-muted/80 text-foreground hover:bg-muted/80'
                  )}
                  onClick={() => handleSeverityClick(severity)}
                >
                  {getSeverityLabel(severity)}
                  <span
                    className={cn(
                      'min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-medium leading-none text-muted-foreground',
                      isSelected ? 'bg-background/80' : 'bg-muted/70'
                    )}
                  >
                    {notifySummary?.[severity] ?? 0}
                  </span>
                </Button>
              );
            })}
          </div>
          <NotificationList
            className="relative max-h-[78vh] overflow-auto"
            notifyStatus={notifyStatus}
            data={notifyPage?.pages}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onShowMoreClick={() => fetchNextPage()}
            emptyMessage={
              selectedSeverity
                ? t('notification.noSeverity', { severity: getSeverityLabel(selectedSeverity) })
                : undefined
            }
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
