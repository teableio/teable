import type { ITableFullVo, ITableListVo, IRecord } from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';
import type {
  ShareViewGetVo,
  AcceptInvitationLinkRo,
  AcceptInvitationLinkVo,
  IGetBaseVo,
} from '@teable-group/openapi';
import { ACCEPT_INVITATION_LINK, SHARE_VIEW_GET, urlBuilder } from '@teable-group/openapi';
import { axios } from './axios';

export class SsrApi {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor() {}

  async getTable(baseId: string, tableId: string, viewId?: string) {
    return axios
      .get<ITableFullVo>(`/base/${baseId}/table/${tableId}`, {
        params: {
          includeContent: true,
          viewId,
          fieldKeyType: FieldKeyType.Id,
        },
      })
      .then(({ data }) => data);
  }

  async getTables(baseId: string) {
    return axios.get<ITableListVo>(`/base/${baseId}/table`).then(({ data }) => data);
  }

  async getDefaultViewId(tableId: string) {
    return axios.get<{ id: string }>(`/table/${tableId}/defaultViewId`).then(({ data }) => data);
  }

  async getRecord(tableId: string, recordId: string) {
    return axios
      .get<IRecord>(`/table/${tableId}/record/${recordId}`, {
        params: { fieldKeyType: FieldKeyType.Id },
      })
      .then(({ data }) => data);
  }

  async getBaseById(baseId: string) {
    return await axios.get<IGetBaseVo>(`/base/${baseId}`).then(({ data }) => data);
  }

  async acceptInvitationLink(acceptInvitationLinkRo: AcceptInvitationLinkRo) {
    return axios
      .post<AcceptInvitationLinkVo>(ACCEPT_INVITATION_LINK, acceptInvitationLinkRo)
      .then(({ data }) => data);
  }

  async getShareView(shareId: string) {
    return axios
      .get<ShareViewGetVo>(urlBuilder(SHARE_VIEW_GET, { shareId }))
      .then(({ data }) => data);
  }
}

export const ssrApi = new SsrApi();
