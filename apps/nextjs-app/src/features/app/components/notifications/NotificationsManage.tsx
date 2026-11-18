import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { INotification, INotificationIcon } from '@teable/core';
import {
  NotificationSeverityEnum,
  NotificationStatesEnum,
  NotificationTypeEnum,
} from '@teable/core';
import { Bell, Download } from '@teable/icons';
import {
  getNotificationSummary,
  notificationReadAll,
  updateNotificationStatus,
} from '@teable/openapi';
import { useNotification } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
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
import { NotificationPanel } from './NotificationPanel';

const UNREAD_INVITE_TOAST_LIMIT = 3;
// Matches the 1-month expiry of email invitation records: older unread invites
// stay in the bell but are no longer recalled as toasts on app open.
const UNREAD_INVITE_RECALL_WINDOW_DAYS = 30;
const TOAST_AUTO_CLOSE_DURATION = ms('3s');
const TOAST_MANUAL_CLOSE_DURATION = Infinity;
const CREDIT_EXHAUSTED_NOTIFICATION_TOAST_ID = 'credit-exhausted-notification';
// AI tasks, automations and routines running out of credit all say the same thing.
const CREDIT_NOTIFICATION_I18N_KEYS = new Set([
  'email.templates.notify.task.ai.cancelled.creditExhausted',
  'email.templates.notify.automation.insufficientCredit.title',
  'email.templates.notify.routine.insufficientCredit.title',
]);
// The badge count and both catch-up lists arrive in one request, shared by the bell and the alerts.
const notificationSummaryQuery = {
  queryKey: ReactQueryKeys.notifySummary(),
  queryFn: () => getNotificationSummary().then(({ data }) => data),
};

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

// Critical toasts stay until closed, and Critical alerts come in bursts — a space out of credit
// fails every routine and automation at once. Those of one kind share a toast, the latest
// replacing the one on screen; every one of them stays unread in the bell.
export const getNotificationToastId = (
  notification: Pick<INotification, 'id' | 'messageI18n' | 'severity'>
) => {
  const i18nKey = parseMessageI18n(notification.messageI18n)?.i18nKey;
  if (typeof i18nKey !== 'string') return notification.id;
  const today = dayjs().format('YYYY-MM-DD');
  if (CREDIT_NOTIFICATION_I18N_KEYS.has(i18nKey)) {
    return `${today}-${CREDIT_EXHAUSTED_NOTIFICATION_TOAST_ID}`;
  }
  return notification.severity === NotificationSeverityEnum.Critical
    ? `${today}-${i18nKey}`
    : notification.id;
};

const getExportBaseInfo = (notification: Pick<INotification, 'messageI18n' | 'url'>) => {
  const parsed = parseMessageI18n(notification.messageI18n);
  if (!parsed) return null;
  const baseName = parsed.context?.baseName || '';
  return {
    // Older notifications carry no baseId; the dialog then falls back to matching the name.
    baseId: typeof parsed.context?.baseId === 'string' ? parsed.context.baseId : undefined,
    baseName,
    fileName: parsed.context?.name || baseName,
    downloadUrl: notification.url || parsed.context?.previewUrl || '',
    isSuccess: parsed.i18nKey === 'email.templates.notify.exportBase.success.message',
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
        {fileName && <div className="text-muted-foreground truncate text-xs">{fileName}</div>}
      </div>
      {isSuccess && downloadUrl && (
        <a
          href={downloadUrl}
          download={fileName || undefined}
          className="ms-auto"
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
    if (
      parseMessageI18n(notification.messageI18n)?.i18nKey ===
      'email.templates.notify.exportBase.cancelled.message'
    ) {
      showGeneralNotificationToast(notification, toastId, onAcknowledge);
      return;
    }
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
  // ten minutes hidden and presence does not replay what was missed — so the
  // catch-up lists refetch on focus along with the badge count. Anything already
  // surfaced is dropped by the session dedup, so a refetch can only add missed items.
  const { data: notificationSummary } = useQuery(notificationSummaryQuery);
  const criticalAdminNotices = notificationSummary?.criticalAdminNotices;
  const unreadInviteNotifications = notificationSummary?.unreadInvites;

  const { mutate: markNotificationAsRead } = useMutation({
    mutationFn: (notificationId: string) =>
      updateNotificationStatus({ notificationId, updateNotifyStatusRo: { isRead: true } }),
    onSuccess: () => {
      onMarkedRead();
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifySummary() });
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
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifySummary() });
    },
    [queryClient, onMarkedRead]
  );

  // Everything is read: drop the alert surfaces and the catch-up cache with
  // them. Reset rather than invalidate — cached rows would otherwise re-toast
  // on the next remount.
  const clearAlerts = useCallback(() => {
    setImportantNotifications([]);
    toast.dismiss();
    queryClient.resetQueries({ queryKey: ReactQueryKeys.notifySummary() });
  }, [queryClient]);

  return { importantNotifications, acknowledgeImportant, clearAlerts };
};

export const NotificationsManage: React.FC = () => {
  const queryClient = useQueryClient();
  const notification = useNotification();

  const [isOpen, setOpen] = useState(false);
  const [newUnreadCount, setNewUnreadCount] = useState<number | undefined>(undefined);

  const dropSocketUnreadCount = useCallback(() => setNewUnreadCount(undefined), []);

  const { importantNotifications, acknowledgeImportant, clearAlerts } =
    useNotificationAlerts(dropSocketUnreadCount);

  const { data: queryUnreadCount = 0 } = useQuery({
    ...notificationSummaryQuery,
    select: (data) => data.unreadCount,
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
  // Pushed while the panel is open; the list shows them after a refresh.
  const newArrivals = newUnreadCount ? Math.max(0, newUnreadCount - queryUnreadCount) : 0;

  const refresh = () => {
    setNewUnreadCount(undefined);
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifySummary() });
    queryClient.resetQueries({ queryKey: ReactQueryKeys.notifyList() });
  };

  const { mutate: markAllAsRead } = useMutation({
    mutationFn: notificationReadAll,
    onSuccess: () => {
      clearAlerts();
      refresh();
    },
  });

  return (
    <>
      <Popover open={isOpen} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs" className="relative" onClick={refresh}>
            <Bell className="size-5 shrink-0" />
            {unreadCount > 0 && (
              <span className="absolute end-2.5 top-1 inline-flex -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-red-400 p-1 text-[8px] leading-none text-white rtl:-translate-x-1/2">
                {unreadCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="left"
          align="end"
          className="w-96 max-w-[calc(100vw-1rem)] p-0"
          // Opening the panel must not focus (and tooltip) its first header button.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <NotificationPanel
            isOpen={isOpen}
            unreadCount={unreadCount}
            newCount={newArrivals}
            onRefresh={refresh}
            onMarkAllRead={() => markAllAsRead()}
            onNavigate={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <ImportantNotificationPopup
        notifications={importantNotifications}
        onAcknowledge={acknowledgeImportant}
      />
    </>
  );
};
