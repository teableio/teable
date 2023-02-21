import { ky } from '../../config/ky';
import type { JsonApiResponse } from '../json-api';
import { isJsonApiSuccessResponse } from '../json-api';
import type { ITableData } from './table.types';

export const fetchTableWithId = async (id: string): Promise<ITableData> => {
  return ky
    .get(`/api/table/${id}`)
    .json<JsonApiResponse<ITableData>>()
    .then((resp) => {
      if (!isJsonApiSuccessResponse(resp)) {
        throw new Error(`Error fetching teable: ${resp.errors}`);
      }
      return resp.data;
    });
};
