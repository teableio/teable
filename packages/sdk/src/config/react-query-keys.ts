/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IAggregationRo,
  IGroupPointsRo,
  IRowCountRo,
  NotificationStatesEnum,
} from '@teable-group/core';
import type { IShareViewAggregationsRo, IShareViewRowCountRo } from '@teable-group/openapi';

export type ReactQueryKeys = {
  spaceCollaboratorList: (spaceId: string) => [string, string];

  baseCollaboratorList: (baseId: string) => [string, string];

  notifyList: (filter: { status: NotificationStatesEnum }) => [string, string, unknown];
  notifyUnreadCount: () => [string, string];

  rowCount: (tableId: string, query: IRowCountRo) => [string, string, IRowCountRo];
  groupPoints: (tableId: string, query: IGroupPointsRo) => [string, string, IGroupPointsRo];
  aggregations: (tableId: string, query: IAggregationRo) => [string, string, IAggregationRo];

  shareViewRowCount: (
    shareId: string,
    query: IShareViewRowCountRo
  ) => [string, string, IRowCountRo];
  shareViewGroupPoints: (
    shareId: string,
    query: IGroupPointsRo
  ) => [string, string, IGroupPointsRo];
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
  groupPoints: (tableId, query) => ['group-points', tableId, query],
  aggregations: (tableId, query) => ['aggregations', tableId, query],

  shareViewRowCount: (shareId, query) => ['share-view-row-count', shareId, query],
  shareViewGroupPoints: (shareId, query) => ['share-view-group-points', shareId, query],
  shareViewAggregations: (shareId, query) => ['share-view-aggregations', shareId, query],
};
