import type { IFieldVo, IRecord, ITableFullVo, ITableListVo } from '@teable/core';
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
} from '@teable/openapi';
import {
  ACCEPT_INVITATION_LINK,
  GET_BASE,
  GET_BASE_LIST,
  GET_DEFAULT_VIEW_ID,
  GET_FIELD_LIST,
  GET_RECORD_URL,
  GET_SPACE,
  GET_TABLE,
  GET_TABLE_LIST,
  SHARE_VIEW_GET,
  SPACE_COLLABORATE_LIST,
  UPDATE_NOTIFICATION_STATUS,
  urlBuilder,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { getAxios } from './axios';

export class SsrApi {
  axios: AxiosInstance;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor() {
    this.axios = getAxios();
  }

  async getTable(baseId: string, tableId: string, viewId?: string) {
    return this.axios
      .get<ITableFullVo>(urlBuilder(GET_TABLE, { baseId, tableId }), {
        params: {
          includeContent: true,
          viewId,
          fieldKeyType: FieldKeyType.Id,
        },
      })
      .then(({ data }) => data);
  }

  async getFields(tableId: string) {
    return this.axios
      .get<IFieldVo[]>(urlBuilder(GET_FIELD_LIST, { tableId }))
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

  async getBaseListBySpaceId(spaceId: string) {
    return await this.axios
      .get<IGetBaseVo[]>(urlBuilder(GET_BASE_LIST, { spaceId }))
      .then(({ data }) => data);
  }

  async getSpaceCollaboratorList(spaceId: string) {
    return await this.axios
      .get<ListSpaceCollaboratorVo>(urlBuilder(SPACE_COLLABORATE_LIST, { spaceId }))
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
}
