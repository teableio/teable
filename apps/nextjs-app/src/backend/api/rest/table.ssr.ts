import type { IJsonApiResponse, ITableSnapshot } from '@teable-group/core';
import { isJsonApiSuccessResponse } from '@teable-group/core';
import axios from 'axios';

export class SsrApi {
  async getSnapshot(tableId: string, viewId?: string): Promise<ITableSnapshot> {
    return axios
      .get<IJsonApiResponse<ITableSnapshot>>(
        `http://localhost:${process.env.PORT}/api/table/${tableId}/ssr`
      )
      .then(({ data: resp }) => {
        if (isJsonApiSuccessResponse(resp)) {
          return resp.data;
        }
        throw new Error('fail to fetch ssr snapshot');
      });
  }
}
