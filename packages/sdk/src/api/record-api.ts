import type { IGetRecordsQuery, IRecordsVo } from '@teable-group/core';
import { RecordPath } from '@teable-group/openapi';
import { axios } from '../config/axios';
import { urlBuilder } from './utils';

// eslint-disable-next-line @typescript-eslint/naming-convention
const { GET_RECORDS_URL } = RecordPath;

export const getRecords = async (tableId: string, query: IGetRecordsQuery) => {
  return axios.post<IRecordsVo>(
    urlBuilder(GET_RECORDS_URL, {
      params: { tableId },
      query,
    })
  );
};
