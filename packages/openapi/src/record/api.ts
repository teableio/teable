import type { IJsonApiResponse } from '@teable-group/core';
import axios from 'axios';
import { urlBuilder } from '../utils';
import { GET_RECORDS_URL } from './path';
import type { RecordsQuery, RecordsVo } from './schema.def';

export const getRecords = async (tableId: string, query: RecordsQuery) => {
  return axios.post<IJsonApiResponse<RecordsVo>>(
    urlBuilder(GET_RECORDS_URL, {
      params: { tableId },
      query,
    })
  );
};
