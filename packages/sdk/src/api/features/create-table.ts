import { ky } from '../../config/ky';
import type { JsonApiResponse } from '../json-api';
import { isJsonApiSuccessResponse } from '../json-api';
import type { ITableData } from './table.types';

export const createTable = async (name: string): Promise<ITableData> => {
  return ky
    .post(`/api/table`, {
      json: { name },
    })
    .json<JsonApiResponse<ITableData>>()
    .then((resp) => {
      if (!isJsonApiSuccessResponse(resp)) {
        throw new Error(`Error fetching teable: ${resp.errors}`);
      }
      return resp.data;
    });
};
