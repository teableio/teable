import type { INotification } from '@teable/core';
import {
  NotificationSeverityEnum,
  NotificationStatesEnum,
  NotificationTypeEnum,
} from '@teable/core';
import type { IGetNotifyListQuery } from '@teable/openapi';

/**
 * The panel shows one list, newest first, read and unread together. The list
 * endpoint only answers one read state (and at most one type or severity) at a
 * time, so a filter becomes several paged streams that are merged by time here.
 */

export type INotificationSource = 'all' | 'mine' | 'system';

export interface INotificationFilter {
  source: INotificationSource;
  /** The level the sender gave it, under the system source only; none means every level. */
  severity: NotificationSeverityEnum | null;
  unreadOnly: boolean;
}

export const DEFAULT_NOTIFICATION_FILTER: INotificationFilter = {
  source: 'all',
  severity: null,
  unreadOnly: false,
};

const SOURCES: INotificationSource[] = ['all', 'mine', 'system'];
export const NOTIFICATION_SEVERITIES = [
  NotificationSeverityEnum.Critical,
  NotificationSeverityEnum.Warning,
  NotificationSeverityEnum.Info,
];

/** Whatever was stored, read back as a filter the panel can show. */
export const normalizeNotificationFilter = (value: unknown): INotificationFilter => {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<INotificationFilter>;
  const source = SOURCES.includes(raw.source as INotificationSource)
    ? (raw.source as INotificationSource)
    : DEFAULT_NOTIFICATION_FILTER.source;
  return {
    source,
    // A level only narrows system notifications; leaving that source drops it.
    severity:
      source === 'system' &&
      NOTIFICATION_SEVERITIES.includes(raw.severity as NotificationSeverityEnum)
        ? (raw.severity as NotificationSeverityEnum)
        : null,
    unreadOnly: raw.unreadOnly === true,
  };
};

// Sent by a person: mentions, comments, invites.
const MINE_TYPES = [
  NotificationTypeEnum.CollaboratorCellTag,
  NotificationTypeEnum.CollaboratorMultiRowTag,
  NotificationTypeEnum.Comment,
  NotificationTypeEnum.CollaboratorInvite,
];
// Everything else: the product, an admin or a connected app.
const SYSTEM_TYPES = [
  NotificationTypeEnum.System,
  NotificationTypeEnum.ExportBase,
  NotificationTypeEnum.AdminNotice,
  NotificationTypeEnum.OAuthApp,
];

export type IFeedStreamQuery = Omit<IGetNotifyListQuery, 'cursor'>;

export interface IFeedStream {
  key: string;
  query: IFeedStreamQuery;
}

export const getFeedStreams = (filter: INotificationFilter): IFeedStream[] => {
  const states = filter.unreadOnly
    ? [NotificationStatesEnum.Unread]
    : [NotificationStatesEnum.Unread, NotificationStatesEnum.Read];

  const types =
    filter.source === 'mine' ? MINE_TYPES : filter.source === 'system' ? SYSTEM_TYPES : [undefined];
  const severity = filter.severity ?? undefined;

  return states.flatMap((notifyStates) =>
    types.map((notifyType) => ({
      key: [notifyStates, notifyType ?? 'any', severity ?? 'any'].join(':'),
      query: {
        notifyStates,
        ...(notifyType ? { notifyType } : {}),
        ...(severity ? { severity } : {}),
      },
    }))
  );
};

export interface IFeedPage {
  streams: Record<string, { notifications: INotification[]; nextCursor?: string | null }>;
}

/** Cursor per stream to fetch next; `null` starts a stream from the top. */
export type IFeedPageParam = Record<string, string | null> | undefined;

interface IStreamState {
  items: INotification[];
  nextCursor?: string | null;
}

const collectStreams = (streams: IFeedStream[], pages: IFeedPage[]) => {
  const states = new Map<string, IStreamState>(streams.map(({ key }) => [key, { items: [] }]));
  pages.forEach((page) => {
    Object.entries(page.streams).forEach(([key, chunk]) => {
      const state = states.get(key);
      if (!state) return;
      state.items.push(...chunk.notifications);
      state.nextCursor = chunk.nextCursor;
    });
  });
  return states;
};

const timeOf = (notification: INotification) => new Date(notification.createdTime).getTime();

/**
 * The newest "last loaded" time among streams that still have more: anything
 * older than it may still be missing from those streams, so it waits.
 */
const getBoundary = (states: Map<string, IStreamState>) => {
  let boundary: number | undefined;
  let boundaryKey: string | undefined;
  states.forEach((state, key) => {
    const last = state.items[state.items.length - 1];
    if (!state.nextCursor || !last) return;
    const time = timeOf(last);
    if (boundary === undefined || time > boundary) {
      boundary = time;
      boundaryKey = key;
    }
  });
  return { boundary, boundaryKey };
};

export const mergeFeed = (streams: IFeedStream[], pages: IFeedPage[]) => {
  const states = collectStreams(streams, pages);
  const { boundary } = getBoundary(states);
  const byId = new Map<string, INotification>();
  states.forEach((state) => state.items.forEach((item) => byId.set(item.id, item)));
  const notifications = [...byId.values()]
    .filter((item) => boundary === undefined || timeOf(item) >= boundary)
    .sort((a, b) => timeOf(b) - timeOf(a) || (a.id < b.id ? 1 : -1));
  return { notifications, hasMore: boundary !== undefined };
};

/** Loading more advances the stream that holds the list back. */
export const getNextFeedPageParam = (
  streams: IFeedStream[],
  pages: IFeedPage[]
): IFeedPageParam => {
  const states = collectStreams(streams, pages);
  const { boundaryKey } = getBoundary(states);
  const cursor = boundaryKey ? states.get(boundaryKey)?.nextCursor : undefined;
  return boundaryKey && cursor ? { [boundaryKey]: cursor } : undefined;
};
