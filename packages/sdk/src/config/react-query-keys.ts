/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IFieldRo,
  IConvertFieldRo,
  NotificationStatesEnum,
  IGetFieldsQuery,
} from '@teable/core';
import type {
  IListBaseCollaboratorUserRo,
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
  IGetDepartmentListRo,
  IGetDepartmentUserRo,
  IShareViewCollaboratorsRo,
  ICreateRecordsRo,
  IUpdateRecordRo,
  IUpdateRecordsRo,
  IRecordInsertOrderRo,
  IUpdateRecordOrdersRo,
} from '@teable/openapi';

export const ReactQueryKeys = {
  space: (spaceId: string) => ['space', spaceId] as const,

  base: (baseId: string) => ['base', baseId] as const,

  baseAll: () => ['base-all'] as const,

  templateList: () => ['template-list'] as const,

  templateCategoryList: () => ['template-category-list'] as const,

  templateDetail: (templateId: string) => ['template-detail', templateId] as const,

  publishedTemplateCategoryList: () => ['published-template-category-list'] as const,

  publishedTemplateList: () => ['published-template-list'] as const,

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

  instanceUsage: () => ['instance-usage'] as const,

  spaceCollaboratorList: (spaceId: string, options?: ListSpaceCollaboratorRo) =>
    options
      ? (['space-collaborator-list', spaceId, options] as const)
      : (['space-collaborator-list', spaceId] as const),

  baseCollaboratorList: (baseId: string, options?: ListBaseCollaboratorRo) =>
    options
      ? (['base-collaborator-list', baseId, options] as const)
      : (['base-collaborator-list', baseId] as const),

  baseCollaboratorListUser: (baseId: string, options?: IListBaseCollaboratorUserRo) =>
    options
      ? (['base-collaborator-list-user', baseId, options] as const)
      : (['base-collaborator-list-user', baseId] as const),

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

  createField: (tableId: string, fieldRo: IFieldRo) => ['create-field', tableId, fieldRo] as const,

  deleteField: (tableId: string, fieldId: string) => ['delete-field', tableId, fieldId] as const,

  convertField: (tableId: string, fieldId: string, fieldRo: IConvertFieldRo) =>
    ['convert-field', tableId, fieldId, fieldRo] as const,

  planFieldCreate: (tableId: string, fieldRo: IFieldRo) =>
    ['create-field-plan', tableId, fieldRo] as const,

  planFieldConvert: (tableId: string, fieldId: string, fieldRo: IConvertFieldRo) =>
    ['convert-field-plan', tableId, fieldId, fieldRo] as const,

  planField: (tableId: string, fieldId: string) => ['field-plan', tableId, fieldId] as const,

  planFieldDelete: (tableId: string, fieldId: string) =>
    ['delete-field-plan', tableId, fieldId] as const,

  createRecords: (tableId: string, recordsRo: ICreateRecordsRo) =>
    ['create-records', tableId, recordsRo] as const,

  updateRecord: (tableId: string, recordId: string, recordRo: IUpdateRecordRo) =>
    ['update-record', tableId, recordId, recordRo] as const,

  updateRecords: (tableId: string, recordsRo: IUpdateRecordsRo) =>
    ['update-records', tableId, recordsRo] as const,

  duplicateRecord: (tableId: string, recordId: string, order: IRecordInsertOrderRo) =>
    ['duplicate-record', tableId, recordId, order] as const,

  updateRecordOrders: (tableId: string, viewId: string, order: IUpdateRecordOrdersRo) =>
    ['update-record-orders', tableId, viewId, order] as const,

  personAccessTokenList: () => ['person-access-token-list'],

  personAccessToken: (id: string) => ['person-access-token-list', id],

  tableInfo: (baseId: string, tableId: string) => ['table-info', baseId, tableId],

  field: (tableId: string) => ['field-info', tableId],

  shareViewCollaborators: (shareId: string, query?: IShareViewCollaboratorsRo) =>
    query
      ? (['share-view-collaborators', shareId, query] as const)
      : (['share-view-collaborators', shareId] as const),

  getViewFilterLinkRecords: (tableId: string, viewId: string) =>
    ['get-view-filter-link-records', tableId, viewId] as const,

  getFieldFilterLinkRecords: (tableId: string, fieldId: string) =>
    ['get-field-filter-link-records', tableId, fieldId] as const,

  shareViewLinkRecords: (shareId: string, fieldId: string, search?: string) =>
    ['share-link-records', shareId, fieldId, search] as const,

  getTablePermission: (baseId: string, tableId: string) =>
    ['table-permission', baseId, tableId] as const,

  getBasePermission: (baseId: string) => ['base-permission', baseId] as const,

  getRecordHistory: (tableId: string, recordId?: string) =>
    ['record-history', tableId, recordId] as const,

  getSharedBase: () => ['shared-base-list'] as const,

  getSpaceTrash: (resourceType: ResourceType) => ['space-trash', resourceType] as const,

  getTrashItems: (resourceId: string) => ['trash-items', resourceId] as const,

  getDashboardList: (baseId: string) => ['dashboard-list', baseId] as const,

  getDashboard: (dashboardId: string) => ['dashboard', dashboardId] as const,

  viewList: (tableId: string) => ['view-list', tableId] as const,

  fieldList: (tableId: string, query?: IGetFieldsQuery) => ['field-list', tableId, query] as const,

  calendarDailyCollection: (tableId: string, query: ICalendarDailyCollectionRo) =>
    ['calendar-daily-collection', tableId, query] as const,

  getDepartmentList: (ro?: IGetDepartmentListRo) => ['department-list', ro] as const,

  getDepartmentUsers: (ro?: IGetDepartmentUserRo) => ['department-users', ro] as const,

  getOrganizationMe: () => ['organization-me'] as const,

  getIntegrationList: (spaceId: string) => ['integration-list', spaceId] as const,

  getPluginPanelList: (tableId: string) => ['plugin-list', tableId] as const,

  getPluginPanel: (tableId: string, panelId: string) => ['plugin', tableId, panelId] as const,

  getPluginContextMenuPlugins: (tableId: string) =>
    ['plugin-context-menu-plugins', tableId] as const,

  getPluginContextMenuPlugin: (tableId: string, pluginInstallId: string) =>
    ['plugin-context-menu-plugin', tableId, pluginInstallId] as const,

  getPublicSetting: () => ['public-setting'] as const,

  userLastVisitMap: (baseId: string) => ['user-last-visit-map', baseId] as const,

  getTaskStatusCollection: (tableId: string) => ['task-status-collection', tableId] as const,

  chatHistory: (baseId: string) => ['chat-history', baseId] as const,

  recentlyBase: () => ['recently-base'] as const,
};
