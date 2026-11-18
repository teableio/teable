import type { INotification, INotificationSystemIcon, INotificationUserIcon } from '@teable/core';
import { NotificationSeverityEnum } from '@teable/core';
import {
  Bell,
  Check,
  ChatRoutine,
  CreditCard,
  Credits,
  Download,
  LayoutTemplate,
  MagicAi,
  MessageSquare,
  Puzzle,
  Sheet,
  UserPlus,
  Zap,
} from '@teable/icons';
import type { ILocaleFunction } from '@teable/sdk/context/app/i18n';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';
import { cn } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useMemo } from 'react';
import { downloadUrlWithFileName } from '@/features/app/utils/download-url';
import { UserAvatar } from '../user/UserAvatar';
import { isExternalNotificationUrl } from './notification-component/external-url';
import { getShowMessage } from './notification-component/get-show-message';
import { splitDownloadLinks } from './notification-downloads';
import { BellDot, FileDown, Gift, MessageCircle, MonitorDot } from './notification-icons';
import type { INotificationCategory } from './notification-meta';
import {
  getNotificationCategory,
  getNotificationI18nKey,
  isPersonNotification,
} from './notification-meta';

const CATEGORY_ICON: Record<INotificationCategory, React.FC<{ className?: string }>> = {
  mention: MessageSquare,
  comment: MessageSquare,
  invite: UserPlus,
  import: Sheet,
  export: FileDown,
  automation: Zap,
  routine: ChatRoutine,
  aiTask: MagicAi,
  aiChat: MessageCircle,
  credit: Credits,
  billing: CreditCard,
  reward: Gift,
  template: LayoutTemplate,
  dataExport: FileDown,
  announcement: Bell,
  app: Puzzle,
  system: MonitorDot,
};

// The glyph only says what kind of notification this is: one look for every
// outcome, so the type can be recognised at a glance.
export const NotificationGlyph = (props: {
  notification: INotification;
  category: INotificationCategory;
}) => {
  const { notification, category } = props;
  const Icon = CATEGORY_ICON[category];

  if (isPersonNotification(category) && 'userName' in notification.notifyIcon) {
    const { userName, userAvatarUrl } = notification.notifyIcon as INotificationUserIcon;
    // The sender alone; what they did is in the line under the message. The
    // fallback sits on the same translucent surface as the type glyphs.
    return (
      <UserAvatar
        className="[&>span]:bg-surface size-8 shrink-0 border bg-transparent"
        user={{ name: userName, avatar: userAvatarUrl }}
      />
    );
  }

  if (category === 'app') {
    const { iconUrl } = notification.notifyIcon as INotificationSystemIcon;
    if (iconUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt=""
          className="border-border size-8 shrink-0 rounded-md border object-cover"
        />
      );
    }
  }

  return (
    <div className="bg-surface text-foreground flex size-8 shrink-0 items-center justify-center rounded-md border">
      <Icon className="size-4" />
    </div>
  );
};

// An unread dot carries the level it was sent with: red for critical, orange
// for warning, and the unread-chat blue for everything else.
const UNREAD_DOT: Record<NotificationSeverityEnum, string> = {
  [NotificationSeverityEnum.Critical]: 'bg-red-500',
  [NotificationSeverityEnum.Warning]: 'bg-orange-500',
  [NotificationSeverityEnum.Info]: 'bg-blue-500',
};

const getExportDownload = (notification: INotification) => {
  if (notification.notifyType !== 'exportBase') return null;
  const i18nKey = getNotificationI18nKey(notification.messageI18n);
  if (i18nKey.includes('failed')) return null;
  try {
    const context = (JSON.parse(notification.messageI18n || '{}').context ?? {}) as Record<
      string,
      string
    >;
    const url = notification.url || context.previewUrl;
    return url ? { url, fileName: context.name || context.baseName || '' } : null;
  } catch {
    return notification.url ? { url: notification.url, fileName: '' } : null;
  }
};

interface INotificationRowProps {
  notification: INotification;
  /** Opening a row reads it; `navigates` says whether this page is leaving for its link. */
  onOpen: (notification: INotification, options?: { navigates?: boolean }) => void;
  onToggleRead: (notification: INotification) => void;
}

export const NotificationRow = (props: INotificationRowProps) => {
  const { notification, onOpen, onToggleRead } = props;
  const { url, isRead, createdTime } = notification;
  const { t } = useTranslation('common');
  const dayjs = useLanDayjs();
  const category = getNotificationCategory(notification);
  const router = useRouter();
  const exportDownload = useMemo(() => getExportDownload(notification), [notification]);
  const hasDetail = Boolean(url) && notification.notifyType !== 'exportBase';
  const { html: message, downloads } = useMemo(() => {
    const split = splitDownloadLinks(getShowMessage(notification, t as ILocaleFunction), {
      isExport: notification.notifyType === 'exportBase',
    });
    // An export whose message carries no link still offers its file.
    if (!split.downloads.length && exportDownload) {
      split.downloads.push({ ...exportDownload, label: t('actions.download') });
    }
    return split;
  }, [notification, t, exportDownload]);
  const time = dayjs(createdTime);

  // A link inside the message (a space, the terms) goes where it says instead
  // of where the row does, and still counts as opening the notification.
  const handleMessageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    event.stopPropagation();
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (!href) return;
    const external = isExternalNotificationUrl(anchor.href);
    onOpen(notification, { navigates: !external });
    if (external) window.open(anchor.href, '_blank', 'noopener,noreferrer');
    else void router.push(href);
  };

  const body = (
    <>
      {/* The type is the glyph's job; its name is a hover away. */}
      <TooltipProvider>
        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <div className={cn('shrink-0 transition-opacity', isRead && 'opacity-50')}>
              <NotificationGlyph notification={notification} category={category} />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">{t(`notification.category.${category}`)}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="min-w-0 flex-1">
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          className={cn(
            'break-words text-sm [overflow-wrap:anywhere] [&_a]:underline [&_a]:decoration-border-high [&_a]:underline-offset-2',
            // Two lines when the row leads to the full story; otherwise this is all there is.
            hasDetail && 'line-clamp-2',
            isRead ? 'text-muted-foreground' : 'text-foreground'
          )}
          dangerouslySetInnerHTML={{ __html: message }}
          onClick={handleMessageClick}
        />
        {downloads.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {downloads.map((download) => (
              <Button
                key={download.url + download.label}
                variant="outline"
                size="xs"
                className="max-w-full gap-1"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpen(notification);
                  void downloadUrlWithFileName(download.url, download.fileName);
                }}
              >
                <Download className="size-3.5 shrink-0" />
                <span className="truncate">{download.label}</span>
              </Button>
            ))}
          </div>
        )}
        <time
          dateTime={createdTime}
          title={time.format('YYYY-MM-DD HH:mm')}
          className="text-muted-foreground mt-1 block text-xs"
        >
          {time.fromNow()}
        </time>
      </div>
    </>
  );

  const rowClassName = 'flex min-w-0 flex-1 gap-3 py-2.5 pe-9 ps-2.5 text-start outline-none';
  const open = () => onOpen(notification);

  let content: React.ReactNode;
  if (!url || !hasDetail) {
    content = (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div className={rowClassName} onClick={open}>
        {body}
      </div>
    );
  } else if (isExternalNotificationUrl(url)) {
    content = (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={rowClassName}
        onClick={open}
      >
        {body}
      </a>
    );
  } else {
    content = (
      <Link href={url} className={rowClassName} onClick={open}>
        {body}
      </Link>
    );
  }

  const toggleLabel = isRead
    ? t('notification.panel.markUnread')
    : t('notification.panel.markRead');

  return (
    <div
      className="has-[a:focus-visible]:bg-accent hover:bg-accent group relative mx-1.5 flex rounded-md transition-colors"
      data-notification-id={notification.id}
    >
      {content}
      {!isRead && (
        <span
          aria-hidden
          className="absolute end-2 top-2.5 flex size-6 items-center justify-center group-focus-within:hidden group-hover:hidden"
        >
          <span
            data-unread-dot={notification.severity}
            className={cn(
              'size-1.5 rounded-full',
              UNREAD_DOT[notification.severity] ?? UNREAD_DOT[NotificationSeverityEnum.Info]
            )}
          />
        </span>
      )}
      {/* While the row is hovered or focused, the dot steps aside for this one action. */}
      <TooltipProvider>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="xs"
              aria-label={toggleLabel}
              className="text-muted-foreground hover:text-foreground absolute end-2 top-1/2 hidden size-7 -translate-y-1/2 p-0 group-focus-within:flex group-hover:flex"
              onClick={(event) => {
                event.stopPropagation();
                onToggleRead(notification);
              }}
            >
              {isRead ? <BellDot className="size-4" /> : <Check className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{toggleLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};
