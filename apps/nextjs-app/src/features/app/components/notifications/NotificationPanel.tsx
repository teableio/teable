import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { INotification, NotificationSeverityEnum } from '@teable/core';
import { CheckCircle2, Filter, Inbox, ListChecks, RefreshCcw } from '@teable/icons';
import { getNotificationList, updateNotificationStatus } from '@teable/openapi';
import { LocalStorageKeys } from '@teable/sdk/config/local-storage-keys';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import {
  Button,
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Label,
  Skeleton,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { cn } from '@teable/ui-lib/shadcn';
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import React, { useMemo } from 'react';
import { useLocalStorage } from 'react-use';
import type {
  IFeedPage,
  IFeedPageParam,
  IFeedStream,
  INotificationFilter,
  INotificationSource,
} from './notification-feed';
import {
  DEFAULT_NOTIFICATION_FILTER,
  NOTIFICATION_SEVERITIES,
  getFeedStreams,
  getNextFeedPageParam,
  mergeFeed,
  normalizeNotificationFilter,
} from './notification-feed';
import { NotificationRow } from './NotificationRow';

const fetchFeedPage = async (
  streams: IFeedStream[],
  pageParam: IFeedPageParam
): Promise<IFeedPage> => {
  // The first page opens every stream; later pages advance the ones asked for.
  const cursors = pageParam ?? Object.fromEntries(streams.map(({ key }) => [key, null]));
  const entries = await Promise.all(
    streams
      .filter(({ key }) => key in cursors)
      .map(async ({ key, query }) => {
        const { data } = await getNotificationList({ ...query, cursor: cursors[key] });
        return [key, { notifications: data.notifications, nextCursor: data.nextCursor }] as const;
      })
  );
  return { streams: Object.fromEntries(entries) };
};

const useNotificationFeed = (filter: INotificationFilter, enabled: boolean) => {
  const streams = useMemo(() => getFeedStreams(filter), [filter]);
  const query = useInfiniteQuery({
    queryKey: [...ReactQueryKeys.notifyList(), 'feed', filter],
    queryFn: ({ pageParam }) => fetchFeedPage(streams, pageParam),
    initialPageParam: undefined as IFeedPageParam,
    getNextPageParam: (_lastPage, allPages) => getNextFeedPageParam(streams, allPages),
    enabled,
    staleTime: 0,
  });
  const { notifications } = useMemo(
    () => mergeFeed(streams, query.data?.pages ?? []),
    [streams, query.data]
  );
  return { ...query, notifications };
};

const useNotificationFilter = () => {
  const [stored, setStored] = useLocalStorage<INotificationFilter>(
    LocalStorageKeys.NotificationFilter,
    DEFAULT_NOTIFICATION_FILTER
  );
  const filter = useMemo(() => normalizeNotificationFilter(stored), [stored]);
  const update = (patch: Partial<INotificationFilter>) =>
    setStored(normalizeNotificationFilter({ ...filter, ...patch }));
  return [filter, update] as const;
};

const RowSkeleton = () => (
  <div className="mx-1.5 flex gap-3 p-2.5">
    <Skeleton className="size-8 shrink-0 rounded-md" />
    <div className="flex flex-1 flex-col gap-2 pt-0.5">
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  </div>
);

const EmptyState = (props: { filter: INotificationFilter; onClear: () => void }) => {
  const { filter, onClear } = props;
  const { t } = useTranslation('common');

  if (filter.unreadOnly && filter.source === 'all' && !filter.severity) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <CheckCircle2 className="text-success size-8" />
        <p className="text-sm font-medium">{t('notification.panel.allCaughtUp')}</p>
      </div>
    );
  }
  const filtered = filter.source !== 'all' || filter.unreadOnly || !!filter.severity;
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Inbox className="text-muted-foreground size-8" />
      <p className="text-sm font-medium">
        {filtered ? t('notification.panel.noMatch') : t('notification.panel.emptyTitle')}
      </p>
      {filtered ? (
        <Button variant="outline" size="xs" className="mt-1" onClick={onClear}>
          {t('notification.panel.filter.clear')}
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">{t('notification.panel.emptyDescription')}</p>
      )}
    </div>
  );
};

/** An icon-only header button; the tooltip carries the words, so long translations fit. */
const HeaderAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Button> & { label: string }
>(({ label, children, className, ...rest }, ref) => (
  <TooltipProvider>
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="xs"
          aria-label={label}
          className={cn(
            'relative size-7 p-0 text-muted-foreground hover:text-foreground',
            className
          )}
          {...rest}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
));
HeaderAction.displayName = 'HeaderAction';

/**
 * The sender's level (critical / warning / info), the old panel's grouping.
 * Only system notifications are sent above info, so it is offered under the
 * system source only. A dot on the button says a level is chosen.
 */
const SeverityFilterMenu = (props: {
  value: NotificationSeverityEnum | null;
  onChange: (severity: NotificationSeverityEnum | null) => void;
}) => {
  const { value, onChange } = props;
  const { t } = useTranslation('common');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <HeaderAction
          label={t('notification.panel.filter.title')}
          className={cn(value && 'bg-accent text-foreground')}
        >
          <Filter className="size-4" />
          {value && <span className="absolute end-1 top-1 size-1.5 rounded-full bg-blue-500" />}
        </HeaderAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {t('notification.panel.filter.severity')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value ?? 'all'}
          onValueChange={(next) =>
            onChange(next === 'all' ? null : (next as NotificationSeverityEnum))
          }
        >
          <DropdownMenuRadioItem value="all">
            {t('notification.sections.all')}
          </DropdownMenuRadioItem>
          {NOTIFICATION_SEVERITIES.map((severity) => (
            <DropdownMenuRadioItem key={severity} value={severity}>
              {t(`notification.severity.${severity}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

type IDayGroup = 'today' | 'yesterday' | 'earlier';

/** Newest first in, newest first out: consecutive rows of the same day share a heading. */
const groupByDay = (notifications: INotification[]) => {
  const today = dayjs().startOf('day');
  const yesterday = today.subtract(1, 'day');
  const groups: { group: IDayGroup; items: INotification[] }[] = [];
  notifications.forEach((notification) => {
    const time = dayjs(notification.createdTime);
    const group: IDayGroup = !time.isBefore(today)
      ? 'today'
      : !time.isBefore(yesterday)
        ? 'yesterday'
        : 'earlier';
    const last = groups[groups.length - 1];
    if (last?.group === group) last.items.push(notification);
    else groups.push({ group, items: [notification] });
  });
  return groups;
};

interface INotificationPanelProps {
  isOpen: boolean;
  unreadCount: number;
  /** Arrived over the socket since the list was last loaded. */
  newCount: number;
  onRefresh: () => void;
  onMarkAllRead: () => void;
  /** A row took the reader somewhere else. */
  onNavigate: () => void;
}

/**
 * One list, newest first, read and unread together: unread rows carry a dot
 * and full-strength text. Filters narrow it by source, by trouble, or to
 * unread, and are remembered for the next time the panel opens.
 */
export const NotificationPanel = (props: INotificationPanelProps) => {
  const { isOpen, unreadCount, newCount, onRefresh, onMarkAllRead, onNavigate } = props;
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const [filter, setFilter] = useNotificationFilter();

  const feed = useNotificationFeed(filter, isOpen);

  const { mutate: setReadState } = useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
      updateNotificationStatus({ notificationId: id, updateNotifyStatusRo: { isRead } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifySummary() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.notifyList() });
    },
  });

  const handleOpen = (notification: INotification, options?: { navigates?: boolean }) => {
    if (!notification.isRead) setReadState({ id: notification.id, isRead: true });
    // Rows without a link (exports) keep the panel open for the download.
    const navigates =
      options?.navigates ?? (Boolean(notification.url) && notification.notifyType !== 'exportBase');
    if (navigates) onNavigate();
  };

  const handleToggleRead = (notification: INotification) =>
    setReadState({ id: notification.id, isRead: !notification.isRead });

  return (
    <div className="flex max-h-[80vh] flex-col">
      <div className="flex items-center gap-2 pb-1.5 pe-2 ps-4 pt-3">
        <h2 className="shrink-0 text-sm font-semibold">{t('notification.title')}</h2>
        {unreadCount > 0 && (
          <span className="text-muted-foreground min-w-0 truncate text-xs tabular-nums">
            {t('notification.panel.unreadCount', { count: unreadCount })}
          </span>
        )}
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground ms-auto max-w-[60%] shrink-0 gap-1"
          disabled={unreadCount < 1}
          onClick={onMarkAllRead}
        >
          <ListChecks className="size-4 shrink-0" />
          <span className="truncate">{t('notification.markAllAsRead')}</span>
        </Button>
      </div>

      <div className="flex items-center gap-2 border-b pb-3 pe-3 ps-4">
        <Tabs
          size="sm"
          className="min-w-0 shrink-0"
          value={filter.source}
          onValueChange={(source) => setFilter({ source: source as INotificationSource })}
        >
          <TabsList className="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="all">{t('notification.panel.filter.all')}</TabsTrigger>
            <TabsTrigger value="mine">{t('notification.panel.filter.mine')}</TabsTrigger>
            <TabsTrigger value="system">{t('notification.panel.filter.system')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ms-auto flex min-w-0 shrink items-center gap-1.5">
          <Label
            htmlFor="notification-unread-only"
            className="text-muted-foreground min-w-0 cursor-pointer truncate text-xs font-normal"
          >
            {t('notification.panel.filter.unreadOnly')}
          </Label>
          <Switch
            id="notification-unread-only"
            size="sm"
            className="shrink-0"
            checked={filter.unreadOnly}
            onCheckedChange={(unreadOnly) => setFilter({ unreadOnly })}
          />
        </div>
        {filter.source === 'system' && (
          <div className="shrink-0">
            <SeverityFilterMenu
              value={filter.severity}
              onChange={(severity) => setFilter({ severity })}
            />
          </div>
        )}
      </div>

      {newCount > 0 && (
        <button
          type="button"
          className="bg-primary/5 text-primary hover:bg-primary/10 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium transition-colors"
          onClick={onRefresh}
        >
          <RefreshCcw className="size-3.5" />
          {t('notification.new', { count: newCount })}
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-1.5">
        {feed.isPending ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : feed.notifications.length ? (
          <>
            {groupByDay(feed.notifications).map(({ group, items }) => (
              <section key={group}>
                <h3 className="bg-popover text-muted-foreground sticky top-0 z-10 px-4 py-2 text-xs font-medium">
                  {t(`notification.panel.group.${group}`)}
                </h3>
                {items.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onOpen={handleOpen}
                    onToggleRead={handleToggleRead}
                  />
                ))}
              </section>
            ))}
            {feed.hasNextPage && (
              <div className="px-4 py-1">
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground w-full"
                  disabled={feed.isFetchingNextPage}
                  onClick={() => feed.fetchNextPage()}
                >
                  {t('notification.showMore')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState filter={filter} onClear={() => setFilter(DEFAULT_NOTIFICATION_FILTER)} />
        )}
      </div>
    </div>
  );
};
