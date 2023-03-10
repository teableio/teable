import type { IFullSsrSnapshot, IJsonApiResponse } from '@teable-group/core';
import { isJsonApiSuccessResponse } from '@teable-group/core';
import axios from 'axios';

export class SsrApi {
  async getFullSnapshot(tableId: string, viewId = ''): Promise<IFullSsrSnapshot> {
    console.log(`http://localhost:${process.env.PORT}/api/table/ssr/${tableId}/${viewId}`);
    return axios
      .get<IJsonApiResponse<IFullSsrSnapshot>>(
        `http://localhost:${process.env.PORT}/api/table/ssr/${tableId}/${viewId}`
      )
      .then(({ data: resp }) => {
        if (isJsonApiSuccessResponse(resp)) {
          return resp.data;
        }
        throw new Error('fail to fetch ssr snapshot');
      });
  }

  async getTableSnapshot() {
    return axios
      .get<IJsonApiResponse<Pick<IFullSsrSnapshot, 'tables'>>>(
        `http://localhost:${process.env.PORT}/api/table/ssr`
      )
      .then(({ data: resp }) => {
        if (isJsonApiSuccessResponse(resp)) {
          return resp.data;
        }
        throw new Error('fail to fetch table snapshot');
      });
  }

  async getDefaultViewId(tableId: string) {
    return axios
      .get<IJsonApiResponse<{ id: string }>>(
        `http://localhost:${process.env.PORT}/api/table/ssr/${tableId}/view-id`
      )
      .then(({ data: resp }) => {
        if (isJsonApiSuccessResponse(resp)) {
          return resp.data;
        }
        throw new Error('fail to fetch default view id');
      });
  }
}
