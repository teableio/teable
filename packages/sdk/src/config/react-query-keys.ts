/* eslint-disable @typescript-eslint/naming-convention */
import type { IAggregationRo, IRowCountRo, NotificationStatesEnum } from '@teable-group/core';
import type { IShareViewAggregationsRo, IShareViewRowCountRo } from '@teable-group/openapi';

export type ReactQueryKeys = {
  spaceCollaboratorList: (spaceId: string) => [string, string];

  baseCollaboratorList: (baseId: string) => [string, string];

  notifyList: (filter: { status: NotificationStatesEnum }) => [string, string, unknown];
  notifyUnreadCount: () => [string, string];

  rowCount: (tableId: string, query: IRowCountRo) => [string, string, IRowCountRo];
  aggregations: (tableId: string, query: IAggregationRo) => [string, string, IAggregationRo];

  shareViewRowCount: (
    shareId: string,
    query: IShareViewRowCountRo
  ) => [string, string, IRowCountRo];
  shareViewAggregations: (
    shareId: string,
    query: IShareViewAggregationsRo
  ) => [string, string, IAggregationRo];
};

export const ReactQueryKeys: ReactQueryKeys = {
  spaceCollaboratorList: (spaceId) => ['space-collaborator-list', spaceId],

  baseCollaboratorList: (baseId) => ['base-collaborator-list', baseId],

  notifyList: (filter) => ['notification', 'list', filter],
  notifyUnreadCount: () => ['notification', 'unread-count'],

  rowCount: (tableId, query) => ['row-count', tableId, query],
  aggregations: (tableId, query) => ['aggregations', tableId, query],

  shareViewRowCount: (shareId, query) => ['share-view-row-count', shareId, query],
  shareViewAggregations: (shareId, query) => ['share-view-aggregations', shareId, query],
};
