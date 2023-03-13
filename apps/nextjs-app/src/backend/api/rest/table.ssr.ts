import type { IFullSsrSnapshot, IJsonApiResponse } from '@teable-group/core';
import { isJsonApiSuccessResponse } from '@teable-group/core';
import axios from 'axios';

export class SsrApi {
  axios = axios.create({
    baseURL: `http://localhost:${process.env.PORT}/api`,
  });

  async getFullSnapshot(tableId: string, viewId = ''): Promise<IFullSsrSnapshot> {
    return this.axios
      .get<IJsonApiResponse<IFullSsrSnapshot>>(`/table/ssr/${tableId}/${viewId}`)
      .then(({ data: resp }) => {
        if (isJsonApiSuccessResponse(resp)) {
          return resp.data;
        }
        throw new Error('fail to fetch ssr snapshot');
      });
  }

  async getTableSnapshot() {
    return this.axios
      .get<IJsonApiResponse<Pick<IFullSsrSnapshot, 'tables'>>>(`/table/ssr`)
      .then(({ data: resp }) => {
        if (isJsonApiSuccessResponse(resp)) {
          return resp.data;
        }
        throw new Error('fail to fetch table snapshot');
      });
  }

  async getDefaultViewId(tableId: string) {
    return this.axios
      .get<IJsonApiResponse<{ id: string }>>(`/table/ssr/${tableId}/view-id`)
      .then(({ data: resp }) => {
        if (isJsonApiSuccessResponse(resp)) {
          return resp.data;
        }
        throw new Error('fail to fetch default view id');
      });
  }
}
