import type { IFieldVo, IGetFieldsQuery, IRecord, IViewVo } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import type {
  AcceptInvitationLinkRo,
  AcceptInvitationLinkVo,
  IGetBaseVo,
  IGetDefaultViewIdVo,
  IGetSpaceVo,
  IUpdateNotifyStatusRo,
  ListSpaceCollaboratorVo,
  ShareViewGetVo,
  ITableFullVo,
  ITableListVo,
  ISettingVo,
  IUserMeVo,
  IRecordsVo,
  ITableVo,
  IGetSharedBaseVo,
  IGroupPointsRo,
  IGroupPointsVo,
  ListSpaceCollaboratorRo,
  IPublicSettingVo,
  IGetDashboardVo,
  IGetDashboardListVo,
  IGetBasePermissionVo,
  ITablePermissionVo,
  IGetPinListVo,
  ISubscriptionSummaryVo,
  LastVisitResourceType,
  IUserLastVisitVo,
  IUsageVo,
  IUserLastVisitListBaseVo,
} from '@teable/openapi';
import {
  ACCEPT_INVITATION_LINK,
  GET_BASE,
  GET_BASE_ALL,
  GET_DASHBOARD,
  GET_DASHBOARD_LIST,
  GET_DEFAULT_VIEW_ID,
  GET_FIELD_LIST,
  GET_GROUP_POINTS,
  GET_PUBLIC_SETTING,
  GET_RECORDS_URL,
  GET_RECORD_URL,
  GET_SETTING,
  GET_SHARED_BASE,
  GET_SPACE,
  GET_SPACE_LIST,
  GET_TABLE,
  GET_TABLE_LIST,
  GET_VIEW_LIST,
  SHARE_VIEW_GET,
  SPACE_COLLABORATE_LIST,
  UPDATE_NOTIFICATION_STATUS,
  USER_ME,
  GET_BASE_PERMISSION,
  GET_TABLE_PERMISSION,
  urlBuilder,
  GET_PIN_LIST,
  GET_SUBSCRIPTION_SUMMARY,
  GET_SUBSCRIPTION_SUMMARY_LIST,
  GET_USER_LAST_VISIT,
  GET_INSTANCE_USAGE,
  GET_USER_LAST_VISIT_LIST_BASE,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { getAxios } from './axios';

export class SsrApi {
  axios: AxiosInstance;

  constructor() {
    this.axios = getAxios();
  }

  async getTable(
    baseId: string,
    tableId: string,
    viewId?: string
  ): Promise<ITableFullVo & { extra: IRecordsVo['extra'] }> {
    const fields = await this.getFields(tableId, { viewId });
    const views = await this.axios
      .get<IViewVo[]>(urlBuilder(GET_VIEW_LIST, { tableId }))
      .then(({ data }) => data);
    const table = await this.axios
      .get<ITableVo>(urlBuilder(GET_TABLE, { baseId, tableId }), {
        params: {
          includeContent: true,
          viewId,
          fieldKeyType: FieldKeyType.Id,
        },
      })
      .then(({ data }) => data);

    const currentView = views.find((view) => view.id === viewId);
    const { records, extra } = await this.axios
      .get<IRecordsVo>(urlBuilder(GET_RECORDS_URL, { baseId, tableId }), {
        params: {
          viewId,
          fieldKeyType: FieldKeyType.Id,
          groupBy: currentView?.group ? JSON.stringify(currentView.group) : undefined,
        },
      })
      .then(({ data }) => data);

    return {
      ...table,
      records,
      views,
      fields,
      extra,
    };
  }

  async getFields(tableId: string, query?: IGetFieldsQuery) {
    return this.axios
      .get<IFieldVo[]>(urlBuilder(GET_FIELD_LIST, { tableId }), { params: query })
      .then(({ data }) => data);
  }

  async getViewList(tableId: string) {
    return this.axios
      .get<IViewVo[]>(urlBuilder(GET_VIEW_LIST, { tableId }))
      .then(({ data }) => data);
  }

  async getTables(baseId: string) {
    return this.axios
      .get<ITableListVo>(urlBuilder(GET_TABLE_LIST, { baseId }))
      .then(({ data }) => data);
  }

  async getDefaultViewId(baseId: string, tableId: string) {
    return this.axios
      .get<IGetDefaultViewIdVo>(urlBuilder(GET_DEFAULT_VIEW_ID, { baseId, tableId }))
      .then(({ data }) => data);
  }

  async getRecord(tableId: string, recordId: string) {
    return this.axios
      .get<IRecord>(urlBuilder(GET_RECORD_URL, { tableId, recordId }), {
        params: { fieldKeyType: FieldKeyType.Id },
      })
      .then(({ data }) => data);
  }

  async getBaseById(baseId: string) {
    return await this.axios
      .get<IGetBaseVo>(urlBuilder(GET_BASE, { baseId }))
      .then(({ data }) => data);
  }

  async getSpaceById(spaceId: string) {
    return await this.axios
      .get<IGetSpaceVo>(urlBuilder(GET_SPACE, { spaceId }))
      .then(({ data }) => data);
  }

  async getSpaceList() {
    return await this.axios.get<IGetSpaceVo[]>(urlBuilder(GET_SPACE_LIST)).then(({ data }) => data);
  }

  async getBaseList() {
    return await this.axios.get<IGetBaseVo[]>(GET_BASE_ALL).then(({ data }) => data);
  }

  async getPinList() {
    return await this.axios.get<IGetPinListVo[]>(GET_PIN_LIST).then(({ data }) => data);
  }

  async getBasePermission(baseId: string) {
    return await this.axios
      .get<IGetBasePermissionVo>(urlBuilder(GET_BASE_PERMISSION, { baseId }))
      .then((res) => res.data);
  }

  async getTablePermission(baseId: string, tableId: string) {
    return await this.axios
      .get<ITablePermissionVo>(urlBuilder(GET_TABLE_PERMISSION, { baseId, tableId }))
      .then((res) => res.data);
  }

  async getSpaceCollaboratorList(spaceId: string, query?: ListSpaceCollaboratorRo) {
    return await this.axios
      .get<ListSpaceCollaboratorVo>(urlBuilder(SPACE_COLLABORATE_LIST, { spaceId }), {
        params: query,
      })
      .then(({ data }) => data);
  }

  async getSubscriptionSummary(spaceId: string) {
    return await this.axios
      .get<ISubscriptionSummaryVo>(urlBuilder(GET_SUBSCRIPTION_SUMMARY, { spaceId }))
      .then(({ data }) => data);
  }

  async getSubscriptionSummaryList() {
    return await this.axios
      .get<ISubscriptionSummaryVo[]>(urlBuilder(GET_SUBSCRIPTION_SUMMARY_LIST))
      .then(({ data }) => data);
  }

  async acceptInvitationLink(acceptInvitationLinkRo: AcceptInvitationLinkRo) {
    return this.axios
      .post<AcceptInvitationLinkVo>(ACCEPT_INVITATION_LINK, acceptInvitationLinkRo)
      .then(({ data }) => data);
  }

  async getShareView(shareId: string) {
    return this.axios
      .get<ShareViewGetVo>(urlBuilder(SHARE_VIEW_GET, { shareId }))
      .then(({ data }) => data);
  }

  async updateNotificationStatus(notificationId: string, data: IUpdateNotifyStatusRo) {
    return this.axios
      .patch<void>(urlBuilder(UPDATE_NOTIFICATION_STATUS, { notificationId }), data)
      .then(({ data }) => data);
  }

  async getSetting() {
    return this.axios.get<ISettingVo>(GET_SETTING).then(({ data }) => data);
  }

  async getPublicSetting() {
    return this.axios.get<IPublicSettingVo>(GET_PUBLIC_SETTING).then(({ data }) => data);
  }

  async getUserMe() {
    return this.axios.get<IUserMeVo>(USER_ME).then(({ data }) => data);
  }

  async getSharedBase() {
    return this.axios.get<IGetSharedBaseVo[]>(GET_SHARED_BASE).then(({ data }) => data);
  }

  async getGroupPoints(tableId: string, query: IGroupPointsRo) {
    return this.axios
      .get<IGroupPointsVo>(urlBuilder(GET_GROUP_POINTS, { tableId }), {
        params: {
          ...query,
          filter: JSON.stringify(query?.filter),
          groupBy: JSON.stringify(query?.groupBy),
        },
      })
      .then(({ data }) => data);
  }

  async getDashboard(baseId: string, dashboardId: string) {
    return this.axios
      .get<IGetDashboardVo>(urlBuilder(GET_DASHBOARD, { baseId, id: dashboardId }))
      .then(({ data }) => data);
  }

  async getDashboardList(baseId: string) {
    return this.axios
      .get<IGetDashboardListVo>(urlBuilder(GET_DASHBOARD_LIST, { baseId }))
      .then(({ data }) => data);
  }

  async getUserLastVisit(resourceType: LastVisitResourceType, parentResourceId: string) {
    return this.axios
      .get<IUserLastVisitVo | undefined>(GET_USER_LAST_VISIT, {
        params: { resourceType, parentResourceId },
      })
      .then(({ data }) => data);
  }

  async getInstanceUsage() {
    return this.axios.get<IUsageVo>(GET_INSTANCE_USAGE).then(({ data }) => data);
  }

  async getRecentlyBase() {
    return this.axios
      .get<IUserLastVisitListBaseVo>(GET_USER_LAST_VISIT_LIST_BASE)
      .then(({ data }) => data);
  }
}
