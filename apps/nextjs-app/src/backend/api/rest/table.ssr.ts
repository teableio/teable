import type { ITableFullVo, ITableListVo, IRecord } from '@teable-group/core';
import { FieldKeyType, HttpError } from '@teable-group/core';
import axios from 'axios';

export class SsrApi {
  axios = axios.create({
    baseURL: `http://localhost:${process.env.PORT}/api`,
  });

  constructor() {
    this.axios.interceptors.response.use(
      (response) => {
        // Any status code that lie within the range of 2xx cause this function to trigger
        return response;
      },
      (error) => {
        const { data, status } = error?.response || {};
        throw new HttpError(data || 'no response from server', status || 500);
      }
    );
  }

  async getTable(tableId: string, viewId?: string) {
    return this.axios
      .get<ITableFullVo>(`/table/${tableId}`, {
        params: {
          includeContent: true,
          viewId,
          fieldKeyType: FieldKeyType.Id,
        },
      })
      .then(({ data }) => data);
  }

  async getTables() {
    return this.axios.get<ITableListVo>(`/table`).then(({ data }) => data);
  }

  async getDefaultViewId(tableId: string) {
    return this.axios
      .get<{ id: string }>(`/table/${tableId}/defaultViewId`)
      .then(({ data }) => data);
  }

  async getRecord(tableId: string, recordId: string) {
    return this.axios
      .get<IRecord>(`/table/${tableId}/record/${recordId}`, {
        params: { fieldKeyType: FieldKeyType.Id },
      })
      .then(({ data }) => data);
  }
}

export const ssrApi = new SsrApi();
