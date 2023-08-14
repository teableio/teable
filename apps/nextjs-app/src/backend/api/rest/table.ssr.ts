import type {
  ITableFullVo,
  IJsonApiResponse,
  ITableListVo,
  IJsonApiErrorResponse,
  IRecord,
} from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';
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
        // Any status codes that falls outside the range of 2xx cause this function to trigger
        if (error.response) {
          // Server responded with a status other than 2xx (or errors without response)
          if (error.response.status >= 500) {
            // Throw error if status is 5xx
            throw error;
          } else {
            // Return empty data if status is 4xx
            return {
              data: {
                success: false,
                errors: [error.response.data],
              } as IJsonApiErrorResponse,
            };
          }
        } else {
          // If no response, throw the error (network error etc.)
          throw error;
        }
      }
    );
  }

  async getTable(tableId: string, viewId?: string) {
    return this.axios
      .get<IJsonApiResponse<ITableFullVo>>(`/table/${tableId}`, {
        params: {
          includeContent: true,
          viewId,
          fieldKeyType: FieldKeyType.Id,
        },
      })
      .then(({ data }) => data);
  }

  async getTables() {
    return this.axios.get<IJsonApiResponse<ITableListVo>>(`/table`).then(({ data }) => data);
  }

  async getDefaultViewId(tableId: string) {
    return this.axios
      .get<IJsonApiResponse<{ id: string }>>(`/table/${tableId}/defaultViewId`)
      .then(({ data }) => data);
  }

  async getRecord(tableId: string, recordId: string) {
    return this.axios
      .get<IJsonApiResponse<IRecord>>(`/table/${tableId}/record/${recordId}`)
      .then(({ data }) => data);
  }
}
