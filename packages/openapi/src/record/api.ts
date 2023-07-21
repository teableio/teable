import type { IJsonApiResponse, IGetRecordsQuery, IRecordsVo } from '@teable-group/core';
import axios from '../axios';
import { urlBuilder } from '../utils';
import { GET_RECORDS_URL } from './path';

export const getRecords = async (tableId: string, query: IGetRecordsQuery) => {
  return axios.post<IJsonApiResponse<IRecordsVo>>(
    urlBuilder(GET_RECORDS_URL, {
      params: { tableId },
      query,
    })
  );
};
