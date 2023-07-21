import type { IFullTableVo, IJsonApiResponse, ITableListVo } from '@teable-group/core';
import { FieldKeyType, isJsonApiSuccessResponse } from '@teable-group/core';
import axios from 'axios';

export class SsrApi {
  axios = axios.create({
    baseURL: `http://localhost:${process.env.PORT}/api`,
  });

  async getTable(tableId: string, viewId?: string) {
    return this.axios
      .get<IJsonApiResponse<IFullTableVo>>(`/table/${tableId}`, {
        params: {
          needFullTable: true,
          viewId,
          fieldKeyType: FieldKeyType.Id,
        },
      })
      .then(({ data: resp }) => {
        if (isJsonApiSuccessResponse(resp)) {
          return resp.data;
        }
        throw new Error('fail to fetch table content');
      });
  }

  async getTables() {
    return this.axios.get<IJsonApiResponse<ITableListVo>>(`/table`).then(({ data: resp }) => {
      if (isJsonApiSuccessResponse(resp)) {
        return resp.data;
      }
      throw new Error('fail to fetch table list');
    });
  }

  async getDefaultViewId(tableId: string) {
    return this.axios
      .get<IJsonApiResponse<{ id: string }>>(`/table/${tableId}/defaultViewId`)
      .then(({ data: resp }) => {
        if (isJsonApiSuccessResponse(resp)) {
          return resp.data;
        }
        throw new Error('fail to fetch default view id');
      });
  }
}
