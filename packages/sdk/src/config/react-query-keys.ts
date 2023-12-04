/* eslint-disable @typescript-eslint/naming-convention */
import type { NotificationStatesEnum } from '@teable-group/core';

export type ReactQueryKeys = {
  notifyList: (filter: { status: NotificationStatesEnum }) => [string, string, unknown];
  notifyUnreadCount: () => [string, string];
};

export const ReactQueryKeys: ReactQueryKeys = {
  notifyList: (filter) => ['notification', 'list', filter],
  notifyUnreadCount: () => ['notification', 'unread-count'],
};
