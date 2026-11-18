import type { INotification } from '@teable/core';
import {
  NotificationSeverityEnum,
  NotificationStatesEnum,
  NotificationTypeEnum,
} from '@teable/core';
import type { IFeedPage } from './notification-feed';
import {
  DEFAULT_NOTIFICATION_FILTER,
  getFeedStreams,
  getNextFeedPageParam,
  mergeFeed,
  normalizeNotificationFilter,
} from './notification-feed';

const at = (id: string, minutesAgo: number, isRead = false) =>
  ({
    id,
    isRead,
    createdTime: new Date(Date.UTC(2026, 10, 17, 12) - minutesAgo * 60_000).toISOString(),
  }) as INotification;

describe('getFeedStreams', () => {
  it('reads everything as one unread and one read stream', () => {
    expect(getFeedStreams(DEFAULT_NOTIFICATION_FILTER).map(({ query }) => query)).toEqual([
      { notifyStates: NotificationStatesEnum.Unread },
      { notifyStates: NotificationStatesEnum.Read },
    ]);
  });

  it('asks only for unread when told to', () => {
    const streams = getFeedStreams({ ...DEFAULT_NOTIFICATION_FILTER, unreadOnly: true });
    expect(streams.every(({ query }) => query.notifyStates === 'unread')).toBe(true);
  });

  it('splits "for you" into the person-sent types', () => {
    const types = getFeedStreams({
      ...DEFAULT_NOTIFICATION_FILTER,
      source: 'mine',
      unreadOnly: true,
    }).map(({ query }) => query.notifyType);
    expect(types).toEqual([
      NotificationTypeEnum.CollaboratorCellTag,
      NotificationTypeEnum.CollaboratorMultiRowTag,
      NotificationTypeEnum.Comment,
      NotificationTypeEnum.CollaboratorInvite,
    ]);
  });

  it('adds the chosen level to every stream', () => {
    const streams = getFeedStreams({
      source: 'system',
      severity: NotificationSeverityEnum.Critical,
      unreadOnly: true,
    });
    expect(streams).toHaveLength(4);
    expect(streams.every(({ query }) => query.severity === NotificationSeverityEnum.Critical)).toBe(
      true
    );
  });

  it('gives every stream its own key', () => {
    const keys = getFeedStreams({ source: 'system', severity: null, unreadOnly: false }).map(
      ({ key }) => key
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('normalizeNotificationFilter', () => {
  it('falls back to the default for anything unreadable', () => {
    expect(normalizeNotificationFilter(undefined)).toEqual(DEFAULT_NOTIFICATION_FILTER);
    expect(normalizeNotificationFilter({ source: 'nope' })).toEqual(DEFAULT_NOTIFICATION_FILTER);
  });

  it('drops a level it does not know', () => {
    expect(normalizeNotificationFilter({ source: 'system', severity: 'loud' }).severity).toBeNull();
    expect(normalizeNotificationFilter({ source: 'system', severity: 'warning' }).severity).toBe(
      'warning'
    );
  });

  it('only keeps a level under the system source', () => {
    expect(normalizeNotificationFilter({ source: 'all', severity: 'warning' }).severity).toBeNull();
  });
});

describe('mergeFeed', () => {
  const streams = getFeedStreams(DEFAULT_NOTIFICATION_FILTER);
  const [unreadKey, readKey] = streams.map(({ key }) => key);

  it('interleaves read and unread by time', () => {
    const pages: IFeedPage[] = [
      {
        streams: {
          [unreadKey]: { notifications: [at('u1', 1), at('u2', 30)] },
          [readKey]: { notifications: [at('r1', 10, true), at('r2', 60, true)] },
        },
      },
    ];
    expect(mergeFeed(streams, pages)).toEqual({
      notifications: [at('u1', 1), at('r1', 10, true), at('u2', 30), at('r2', 60, true)],
      hasMore: false,
    });
  });

  it('holds back what a stream with more pages may still precede', () => {
    const pages: IFeedPage[] = [
      {
        streams: {
          [unreadKey]: { notifications: [at('u1', 1), at('u2', 20)], nextCursor: 'u2' },
          [readKey]: { notifications: [at('r1', 10, true), at('r2', 300, true)] },
        },
      },
    ];
    const { notifications, hasMore } = mergeFeed(streams, pages);
    expect(notifications.map(({ id }) => id)).toEqual(['u1', 'r1', 'u2']);
    expect(hasMore).toBe(true);
    expect(getNextFeedPageParam(streams, pages)).toEqual({ [unreadKey]: 'u2' });
  });

  it('lets the held-back rows in once the stream catches up', () => {
    const pages: IFeedPage[] = [
      {
        streams: {
          [unreadKey]: { notifications: [at('u1', 1), at('u2', 20)], nextCursor: 'u2' },
          [readKey]: { notifications: [at('r1', 10, true), at('r2', 300, true)] },
        },
      },
      { streams: { [unreadKey]: { notifications: [at('u3', 400)] } } },
    ];
    expect(mergeFeed(streams, pages).notifications.map(({ id }) => id)).toEqual([
      'u1',
      'r1',
      'u2',
      'r2',
      'u3',
    ]);
    expect(getNextFeedPageParam(streams, pages)).toBeUndefined();
  });
});
