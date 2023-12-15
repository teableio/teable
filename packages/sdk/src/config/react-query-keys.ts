/* eslint-disable @typescript-eslint/naming-convention */
import type { IAggregationRo, IRowCountRo, NotificationStatesEnum } from '@teable-group/core';

export type ReactQueryKeys = {
  notifyList: (filter: { status: NotificationStatesEnum }) => [string, string, unknown];
  notifyUnreadCount: () => [string, string];

  rowCount: (tableId: string, query: IRowCountRo) => [string, string, IRowCountRo];
  aggregation: (tableId: string, query: IAggregationRo) => [string, string, IAggregationRo];
};

export const ReactQueryKeys: ReactQueryKeys = {
  notifyList: (filter) => ['notification', 'list', filter],
  notifyUnreadCount: () => ['notification', 'unread-count'],

  rowCount: (tableId, query) => ['rowCount', tableId, query],
  aggregation: (tableId, query) => ['aggregation', tableId, query],
};
