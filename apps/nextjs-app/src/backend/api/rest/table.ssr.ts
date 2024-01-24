import type { IFieldVo, IRecord, ITableFullVo, ITableListVo } from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';
import type {
  AcceptInvitationLinkRo,
  AcceptInvitationLinkVo,
  IGetBaseVo,
  IGetSpaceVo,
  ListSpaceCollaboratorVo,
  ShareViewGetVo,
} from '@teable-group/openapi';
import { ACCEPT_INVITATION_LINK, SHARE_VIEW_GET, urlBuilder } from '@teable-group/openapi';
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
      .get<ITableFullVo>(`/base/${baseId}/table/${tableId}`, {
        params: {
          includeContent: true,
          viewId,
          fieldKeyType: FieldKeyType.Id,
        },
      })
      .then(({ data }) => data);
  }

  async getFields(tableId: string) {
    return this.axios.get<IFieldVo[]>(`/table/${tableId}/field`).then(({ data }) => data);
  }

  async getTables(baseId: string) {
    return this.axios.get<ITableListVo>(`/base/${baseId}/table`).then(({ data }) => data);
  }

  async getDefaultViewId(baseId: string, tableId: string) {
    return this.axios
      .get<{ id: string }>(`/base/${baseId}/table/${tableId}/defaultViewId`)
      .then(({ data }) => data);
  }

  async getRecord(tableId: string, recordId: string) {
    return this.axios
      .get<IRecord>(`/table/${tableId}/record/${recordId}`, {
        params: { fieldKeyType: FieldKeyType.Id },
      })
      .then(({ data }) => data);
  }

  async getBaseById(baseId: string) {
    return await this.axios.get<IGetBaseVo>(`/base/${baseId}`).then(({ data }) => data);
  }

  async getSpaceById(spaceId: string) {
    return await this.axios.get<IGetSpaceVo>(`/space/${spaceId}`).then(({ data }) => data);
  }

  async getBaseListBySpaceId(spaceId: string) {
    return await this.axios.get<IGetBaseVo[]>(`/space/${spaceId}/base`).then(({ data }) => data);
  }

  async getSpaceCollaboratorList(spaceId: string) {
    return await this.axios
      .get<ListSpaceCollaboratorVo>(`/space/${spaceId}/collaborators`)
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
}

export const ssrApi = new SsrApi();
