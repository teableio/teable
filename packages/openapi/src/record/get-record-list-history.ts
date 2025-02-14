import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IGetRecordHistoryQuery, IRecordHistoryVo } from './get-record-history';
import { recordHistoryVoSchema } from './get-record-history';

export const GET_RECORD_LIST_HISTORY_URL = '/table/{tableId}/record/history';

export const GetRecordListHistoryRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_RECORD_LIST_HISTORY_URL,
  summary: 'Get table records history',
  description:
    'Retrieve the change history of all records in a table, including field modifications and user information.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Get the history list of all records in a table',
      content: {
        'application/json': {
          schema: recordHistoryVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const getRecordListHistory = async (tableId: string, query: IGetRecordHistoryQuery) => {
  return axios.get<IRecordHistoryVo>(
    urlBuilder(GET_RECORD_LIST_HISTORY_URL, {
      tableId,
    }),
    { params: query }
  );
};
