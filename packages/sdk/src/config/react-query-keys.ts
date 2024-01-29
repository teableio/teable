/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IAggregationRo,
  IGroupPointsRo,
  IFieldRo,
  IQueryBaseRo,
  IConvertFieldRo,
  NotificationStatesEnum,
} from '@teable-group/core';
import type { IShareViewRowCountRo, IShareViewAggregationsRo } from '@teable-group/openapi';

export const ReactQueryKeys = {
  spaceCollaboratorList: (spaceId: string) => ['space-collaborator-list', spaceId],

  baseCollaboratorList: (baseId: string) => ['base-collaborator-list', baseId],

  notifyList: (filter: { status: NotificationStatesEnum }) => ['notification', 'list', filter],
  notifyUnreadCount: () => ['notification', 'unread-count'],

  rowCount: (tableId: string, query: IQueryBaseRo) => ['row-count', tableId, query],
  groupPoints: (tableId: string, query: IGroupPointsRo) => ['group-points', tableId, query],
  aggregations: (tableId: string, query: IAggregationRo) => ['aggregations', tableId, query],

  shareViewRowCount: (shareId: string, query: IShareViewRowCountRo) => [
    'share-view-row-count',
    shareId,
    query,
  ],
  shareViewGroupPoints: (shareId: string, query: IGroupPointsRo) => [
    'share-view-group-points',
    shareId,
    query,
  ],
  shareViewAggregations: (shareId: string, query: IShareViewAggregationsRo) => [
    'share-view-aggregations',
    shareId,
    query,
  ],

  planFieldCreate: (tableId: string, fieldRo: IFieldRo) => ['create-field-plan', tableId, fieldRo],

  planFieldConvert: (tableId: string, fieldId: string, fieldRo: IConvertFieldRo) => [
    'create-field-plan',
    tableId,
    fieldId,
    fieldRo,
  ],

  planField: (tableId: string, fieldId: string) => ['field-plan', tableId, fieldId],

  personAccessTokenList: () => ['person-access-token-list'],

  personAccessToken: (id: string) => ['person-access-token-list', id],
};
