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
  updateNotificationStatus,
} from '@teable/openapi';
import { useNotification } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { cn } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import ms from 'ms';
import { useTranslation } from 'next-i18next';
import type { TFunction } from 'next-i18next';
import React, { useCallback, useEffect, useState } from 'react';
import { downloadUrlWithFileName } from '@/features/app/utils/download-url';
import { ImportantNotificationPopup } from './ImportantNotificationPopup';
import { LinkNotification } from './notification-component';
import { NotificationIcon } from './NotificationIcon';
import { NotificationList } from './NotificationList';

const UNREAD_INVITE_TOAST_LIMIT = 3;
// Matches the 1-month expiry of email invitation records: older unread invites
// stay in the bell but are no longer recalled as toasts on app open.
const UNREAD_INVITE_RECALL_WINDOW_DAYS = 30;
const CATCH_UP_STALE_TIME = ms('5m');
const TOAST_AUTO_CLOSE_DURATION = ms('3s');
const TOAST_MANUAL_CLOSE_DURATION = Infinity;
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

// Session-scoped dedup: each notification is surfaced (toast / important popup)
// at most once per page load.
const SHOWN_NOTIFICATIONS_LIMIT = 100;
const shownNotificationIds = new Set<string>();

const markNotificationShown = (notificationId: string) => {
  if (shownNotificationIds.has(notificationId)) return false;
  if (shownNotificationIds.size >= SHOWN_NOTIFICATIONS_LIMIT) {
    shownNotificationIds.clear();
  }
  shownNotificationIds.add(notificationId);
  return true;
};

const isCriticalAdminNotice = (n: INotification) =>
  n.notifyType === NotificationTypeEnum.AdminNotice &&
  n.severity === NotificationSeverityEnum.Critical;

const parseMessageI18n = (
  messageI18n: string | null | undefined
): { i18nKey?: string; context?: Record<string, string> } | null => {
  try {
    return JSON.parse(messageI18n || '{}');
  } catch {
    return null;
  }
};

// Invite toasts never auto-close: they may fire while the user is away from
// the tab, and an invite needs a response — it waits until clicked or closed.
const getNotificationToastDuration = (
  notification: Pick<INotification, 'severity' | 'notifyType'>
) =>
  notification.severity === NotificationSeverityEnum.Critical ||
  notification.notifyType === NotificationTypeEnum.CollaboratorInvite
    ? TOAST_MANUAL_CLOSE_DURATION
    : TOAST_AUTO_CLOSE_DURATION;

const getNotificationToastId = (notification: INotification) => {
  const i18nKey = parseMessageI18n(notification.messageI18n)?.i18nKey;
  return typeof i18nKey === 'string' && CREDIT_NOTIFICATION_I18N_KEYS.has(i18nKey)
    ? `${dayjs().format('YYYY-MM-DD')}-${CREDIT_EXHAUSTED_NOTIFICATION_TOAST_ID}`
    : notification.id;
};

const getExportBaseInfo = (notification: Pick<INotification, 'messageI18n' | 'url'>) => {
  const parsed = parseMessageI18n(notification.messageI18n);
  if (!parsed) return null;
  const baseName = parsed.context?.baseName || '';
  return {
    baseName,
    fileName: parsed.context?.name || baseName,
    downloadUrl: notification.url || parsed.context?.previewUrl || '',
    isSuccess: !parsed.i18nKey?.includes('failed'),
  };
};

const dispatchExportBaseComplete = (notification: Pick<INotification, 'messageI18n' | 'url'>) => {
  const info = getExportBaseInfo(notification);
  if (!info) return false;
  const event = new CustomEvent('export-base-complete', {
    cancelable: true,
    detail: info,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

// Any deliberate act on a toast — clicking it (navigate / download) or closing
// it — consumes the notification, so it is marked read and dismissed. Only an
// auto-close leaves it unread, since the user may never have looked at it.
type IAcknowledgeNotification = (notification: INotification, toastId: string) => void;

const showExportBaseToast = (
  notification: INotification & { notifyIcon: INotificationIcon },
  toastId: string,
  t: TFunction,
  onAcknowledge: IAcknowledgeNotification
) => {
  const { fileName, downloadUrl, isSuccess } = getExportBaseInfo(notification) ?? {
    fileName: '',
    downloadUrl: notification.url || '',
    isSuccess: true,
  };

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
        <a
          href={downloadUrl}
          download={fileName || undefined}
          className="ml-auto"
          onClick={(event) => {
            onAcknowledge(notification, toastId);
            if (!fileName) return;
            event.preventDefault();
            void downloadUrlWithFileName(downloadUrl, fileName);
          }}
        >
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
      onDismiss: () => onAcknowledge(notification, toastId),
    }
  );
};

const showGeneralNotificationToast = (
  notification: INotification,
  toastId: string,
  onAcknowledge: IAcknowledgeNotification
) => {
  toast.info(
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="flex w-full min-w-0 items-center"
      onClickCapture={() => onAcknowledge(notification, toastId)}
    >
      <NotificationIcon notifyIcon={notification.notifyIcon} notifyType={notification.notifyType} />
      <LinkNotification
        data={notification}
        notifyStatus={NotificationStatesEnum.Unread}
        clampMessage
      />
    </div>,
    {
      id: toastId,
      position: 'top-center',
      duration: getNotificationToastDuration(notification),
      closeButton: true,
      onDismiss: () => onAcknowledge(notification, toastId),
    }
  );
};

const showNotificationToast = (
  notification: INotification,
  toastId: string,
  t: TFunction,
  onAcknowledge: IAcknowledgeNotification
) => {
  if (notification.notifyType === NotificationTypeEnum.ExportBase) {
    if (!dispatchExportBaseComplete(notification)) {
      showExportBaseToast(notification, toastId, t, onAcknowledge);
    }
    return;
  }

  showGeneralNotificationToast(notification, toastId, onAcknowledge);
};

/**
 * Surfaces unread notifications outside the bell, over three channels:
 * - live socket notifications → toast (or the important popup for critical
 *   admin notices);
 * - unread critical admin notices caught up by query → important popup;
 * - recent unread collaborator invites caught up by query → manual-close
 *   toasts, so invites received while away are not missed.
 */
const useNotificationAlerts = (onMarkedRead: () => void) => {
  const queryClient = useQueryClient();
  const notification = useNotification();
  const { t } = useTranslation('common');
  const [importantNotifications, setImportantNotifications] = useState<INotification[]>([]);

  // The socket only covers arrivals while it is open — the SDK closes it after
  // ten minutes hidden and presence does not replay what was missed — so both
  // catch-up queries stay refetchable on focus. Anything already surfaced is
  // dropped by the session dedup, so a refetch can only add missed items.
  const { data: criticalAdminNotices } = useQuery({
    queryKey: ReactQueryKeys.notifyCriticalAdmin(),
    queryFn: () =>
      getNotificationList({
        notifyStates: NotificationStatesEnum.Unread,
        severity: NotificationSeverityEnum.Critical,
        notifyType: NotificationTypeEnum.AdminNotice,
      }).then(({ data }) => data.notifications),
    staleTime: CATCH_UP_STALE_TIME,
  });

  const { data: unreadInviteNotifications } = useQuery({
    queryKey: ReactQueryKeys.notifyUnreadInvite(),
    queryFn: () =>
      getNotificationList({
        notifyStates: NotificationStatesEnum.Unread,
        notifyType: NotificationTypeEnum.CollaboratorInvite,
      }).then(({ data }) => data.notifications),
    staleTime: CATCH_UP_STALE_TIME,
  });

  const { mutate: markNotificationAsRead } = useMutation({
    mutationFn: (notificationId: string) =>
      updateNotificationStatus({ notificationId, updateNotifyStatusRo: { isRead: true } }),
    onSuccess: () => {
      onMarkedRead();
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyUnreadCount() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyList() });
    },
  });

  const acknowledgeToast = useCallback<IAcknowledgeNotification>(
    (acknowledged, toastId) => {
      toast.dismiss(toastId);
      markNotificationAsRead(acknowledged.id);
    },
    [markNotificationAsRead]
  );

  const addImportantNotifications = useCallback((items: INotification[]) => {
    if (!items.length) return;
    setImportantNotifications((prev) => {
      const existingIds = new Set(prev.map((p) => p.id));
      const fresh = items.filter((n) => !existingIds.has(n.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  useEffect(() => {
    if (!criticalAdminNotices?.length) return;
    addImportantNotifications(criticalAdminNotices.filter((n) => markNotificationShown(n.id)));
  }, [criticalAdminNotices, addImportantNotifications]);

  useEffect(() => {
    if (!unreadInviteNotifications?.length) return;
    const recallCutoff = dayjs().subtract(UNREAD_INVITE_RECALL_WINDOW_DAYS, 'day');
    unreadInviteNotifications
      .filter((n) => !shownNotificationIds.has(n.id) && dayjs(n.createdTime).isAfter(recallCutoff))
      .slice(0, UNREAD_INVITE_TOAST_LIMIT)
      .forEach((invite) => {
        markNotificationShown(invite.id);
        showGeneralNotificationToast(invite, invite.id, acknowledgeToast);
      });
  }, [unreadInviteNotifications, acknowledgeToast]);

  useEffect(() => {
    const live = notification?.notification;
    if (live == null || live.isRead) return;
    if (!markNotificationShown(live.id)) return;

    if (isCriticalAdminNotice(live)) {
      addImportantNotifications([live]);
      return;
    }

    showNotificationToast(live, getNotificationToastId(live), t, acknowledgeToast);
  }, [notification?.notification, t, acknowledgeToast, addImportantNotifications]);

  const acknowledgeImportant = useCallback(
    (id: string) => {
      setImportantNotifications((prev) => prev.filter((n) => n.id !== id));
      onMarkedRead();
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyList() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyUnreadCount() });
    },
    [queryClient, onMarkedRead]
  );

  // Everything is read: drop the alert surfaces and the catch-up cache with
  // them. Reset rather than invalidate — cached rows would otherwise re-toast
  // on the next remount.
  const clearAlerts = useCallback(() => {
    setImportantNotifications([]);
    toast.dismiss();
    queryClient.resetQueries({ queryKey: ReactQueryKeys.notifyUnreadInvite() });
  }, [queryClient]);

  return { importantNotifications, acknowledgeImportant, clearAlerts };
};

export const NotificationsManage: React.FC = () => {
  const queryClient = useQueryClient();
  const notification = useNotification();
  const { t } = useTranslation('common');

  const [isOpen, setOpen] = useState(false);
  const [newUnreadCount, setNewUnreadCount] = useState<number | undefined>(undefined);
  const [notifyStatus, setNotifyStatus] = useState(NotificationStatesEnum.Unread);
  const [selectedSeverity, setSelectedSeverity] = useState<NotificationSeverityEnum | undefined>(
    undefined
  );

  const dropSocketUnreadCount = useCallback(() => setNewUnreadCount(undefined), []);

  const { importantNotifications, acknowledgeImportant, clearAlerts } =
    useNotificationAlerts(dropSocketUnreadCount);

  const { data: queryUnreadCount = 0 } = useQuery({
    queryKey: ReactQueryKeys.notifyUnreadCount(),
    queryFn: () => getNotificationUnreadCount().then(({ data }) => data.unreadCount),
  });

  // Keyed off the buffer, not the number: after a read drops the override, the
  // next push can carry the same count and still has to re-arm it.
  useEffect(() => {
    if (notification?.unreadCount == null) return;

    setNewUnreadCount(notification.unreadCount);
  }, [notification]);

  // live socket count wins until something reads notifications back — opening
  // the bell (refresh) or acknowledging a toast — which hands the badge back to
  // the freshly invalidated query.
  const unreadCount = newUnreadCount ?? queryUnreadCount;

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

  const refresh = () => {
    setNewUnreadCount(undefined);
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyUnreadCount() });
    queryClient.resetQueries({ queryKey: ReactQueryKeys.notifyList() });
  };

  const { mutateAsync: markAllAsReadMutator } = useMutation({
    mutationFn: notificationReadAll,
    onSuccess: () => {
      clearAlerts();
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyList() });
      refresh();
    },
  });

  const notifySummary = notifyPage?.pages[0]?.summary;
  const totalSummaryCount = notifySummary
    ? notifySummary.critical + notifySummary.warning + notifySummary.info
    : 0;

  const getSeverityLabel = (severity: NotificationSeverityEnum) =>
    t(`notification.severity.${severity}`);

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
    <>
      <Popover onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="relative"
            onClick={() => {
              setNotifyStatus(NotificationStatesEnum.Unread);
              refresh();
            }}
          >
            <Bell className="size-5 shrink-0" />
            {unreadCount > 0 && (
              <span className="absolute right-2.5 top-1 inline-flex -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-red-400 p-1 text-[8px] leading-none text-white">
                {unreadCount}
              </span>
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
              {[undefined, ...NOTIFICATION_SEVERITIES].map((severity) => {
                const isSelected = selectedSeverity === severity;

                return (
                  <Button
                    key={severity ?? 'all'}
                    variant="ghost"
                    size="xs"
                    className={cn(
                      'h-7 gap-1.5 rounded px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                      isSelected && 'bg-foreground/10 text-foreground hover:bg-foreground/10'
                    )}
                    onClick={() => setSelectedSeverity(severity)}
                  >
                    {severity ? getSeverityLabel(severity) : t('notification.sections.all')}
                    <span
                      className={cn(
                        'min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-medium leading-none text-muted-foreground',
                        isSelected ? 'bg-background/80' : 'bg-muted/70'
                      )}
                    >
                      {severity ? notifySummary?.[severity] ?? 0 : totalSummaryCount}
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
            {notifyStatus === NotificationStatesEnum.Unread && (
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
            )}
          </div>
        </PopoverContent>
      </Popover>
      <ImportantNotificationPopup
        notifications={importantNotifications}
        onAcknowledge={acknowledgeImportant}
      />
    </>
  );
};
