import type { IFullSsrSnapshot, IJsonApiResponse } from '@teable-group/core';
import { isJsonApiSuccessResponse } from '@teable-group/core';
import axios from 'axios';

export class SsrApi {
  async getFullSnapshot(tableId: string, viewId?: string): Promise<IFullSsrSnapshot> {
    return axios
      .get<IJsonApiResponse<IFullSsrSnapshot>>(
        `http://localhost:${process.env.PORT}/api/table/ssr/${tableId}`
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
        throw new Error('fail to fetch ssr snapshot');
      });
  }
}
