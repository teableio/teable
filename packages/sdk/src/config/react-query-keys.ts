/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IFieldRo,
  IConvertFieldRo,
  NotificationStatesEnum,
  IGetFieldsQuery,
} from '@teable/core';
import type {
  IShareViewRowCountRo,
  IShareViewAggregationsRo,
  IAggregationRo,
  IGroupPointsRo,
  IQueryBaseRo,
  ResourceType,
  ListSpaceCollaboratorRo,
  IGetRecordsRo,
  ListBaseCollaboratorRo,
  ICalendarDailyCollectionRo,
} from '@teable/openapi';

export const ReactQueryKeys = {
  space: (spaceId: string) => ['space', spaceId] as const,

  base: (baseId: string) => ['base', baseId] as const,

  baseAll: () => ['base-all'] as const,

  baseList: (spaceId: string) => ['base-list', spaceId] as const,

  pinList: () => ['pin-list'] as const,

  spaceList: () => ['space-list'] as const,

  tableList: (baseId: string) => ['table-list', baseId] as const,

  recordCommentCount: (tableId: string, recordId: string) =>
    ['record-comment-count', tableId, recordId] as const,

  commentList: (tableId: string, recordId: string) => ['comment-list', tableId, recordId] as const,

  commentCount: (tableId: string, query?: IGetRecordsRo) =>
    ['comment-count', tableId, query] as const,

  commentDetail: (tableId: string, recordId: string, commentId: string) =>
    ['comment-detail', tableId, recordId, commentId] as const,

  commentAttachment: (tableId: string, recordId: string, path: string) =>
    ['comment-attachment', tableId, recordId, path] as const,

  commentSubscribeStatus: (tableId: string, recordId: string) =>
    ['comment-notify-status', tableId, recordId] as const,

  subscriptionSummary: (spaceId: string) => ['subscription-summary', spaceId] as const,

  subscriptionSummaryList: () => ['subscription-summary'] as const,

  spaceCollaboratorList: (spaceId: string, options?: ListSpaceCollaboratorRo) =>
    options
      ? (['space-collaborator-list', spaceId, options] as const)
      : (['space-collaborator-list', spaceId] as const),

  baseCollaboratorList: (baseId: string, options?: ListBaseCollaboratorRo) =>
    options
      ? (['base-collaborator-list', baseId, options] as const)
      : (['base-collaborator-list', baseId] as const),

  notifyList: (filter: { status: NotificationStatesEnum }) =>
    ['notification', 'list', filter] as const,
  notifyUnreadCount: () => ['notification', 'unread-count'],

  rowCount: (tableId: string, query: IQueryBaseRo) => ['row-count', tableId, query] as const,
  groupPoints: (tableId: string, query: IGroupPointsRo) =>
    ['group-points', tableId, query] as const,
  aggregations: (tableId: string, query: IAggregationRo) =>
    ['aggregations', tableId, query] as const,

  shareView: (shareId: string) => ['share-view', shareId] as const,

  shareViewRowCount: (shareId: string, query: IShareViewRowCountRo) =>
    ['share-view-row-count', shareId, query] as const,
  shareViewGroupPoints: (shareId: string, query: IGroupPointsRo) =>
    ['share-view-group-points', shareId, query] as const,
  shareViewAggregations: (shareId: string, query: IShareViewAggregationsRo) =>
    ['share-view-aggregations', shareId, query] as const,

  planFieldCreate: (tableId: string, fieldRo: IFieldRo) =>
    ['create-field-plan', tableId, fieldRo] as const,

  planFieldConvert: (tableId: string, fieldId: string, fieldRo: IConvertFieldRo) =>
    ['create-field-plan', tableId, fieldId, fieldRo] as const,

  planField: (tableId: string, fieldId: string) => ['field-plan', tableId, fieldId] as const,

  personAccessTokenList: () => ['person-access-token-list'],

  personAccessToken: (id: string) => ['person-access-token-list', id],

  tableInfo: (baseId: string, tableId: string) => ['table-info', baseId, tableId],

  field: (tableId: string) => ['field-info', tableId],

  shareViewCollaborators: (shareId: string, fieldId?: string) =>
    ['share-view-collaborators', shareId, fieldId] as const,

  getViewFilterLinkRecords: (tableId: string, viewId: string) =>
    ['get-view-filter-link-records', tableId, viewId] as const,

  getFieldFilterLinkRecords: (tableId: string, fieldId: string) =>
    ['get-field-filter-link-records', tableId, fieldId] as const,

  shareViewLinkRecords: (shareId: string, fieldId: string, search?: string) =>
    ['share-link-records', shareId, fieldId, search] as const,

  getTablePermission: (baseId: string, tableId: string) =>
    ['table-permission', baseId, tableId] as const,

  getRecordHistory: (tableId: string, recordId?: string) =>
    ['record-history', tableId, recordId] as const,

  getSharedBase: () => ['shared-base-list'] as const,

  getSpaceTrash: (resourceType: ResourceType) => ['space-trash', resourceType] as const,

  getBaseTrashItems: (baseId: string) => ['base-trash-items', baseId] as const,

  getDashboardList: (baseId: string) => ['dashboard-list', baseId] as const,

  getDashboard: (dashboardId: string) => ['dashboard', dashboardId] as const,

  viewList: (tableId: string) => ['view-list', tableId] as const,

  fieldList: (tableId: string, query?: IGetFieldsQuery) => ['field-list', tableId, query] as const,

  calendarDailyCollection: (tableId: string, query: ICalendarDailyCollectionRo) =>
    ['calendar-daily-collection', tableId, query] as const,
};
