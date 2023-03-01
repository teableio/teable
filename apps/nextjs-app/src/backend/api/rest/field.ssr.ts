import type { IFieldVo, IJsonApiResponse } from '@teable-group/core';
import { ky } from '@/config/ky';

export class FieldAPI {
  async getFields(tableId: string) {
    console.log('FieldAPI: node_env', process.env.PORT);
    return ky
      .get(`http://localhost:${process.env.PORT}/api/table/${tableId}/field`)
      .json<IJsonApiResponse<IFieldVo>>()
      .then((resp) => {
        if (resp.success) {
          return resp.data;
        }
      });
  }
}
