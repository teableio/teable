import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IGetRecordsRo } from './get-list';
import { getRecordsRoSchema } from './get-list';

export const GET_RECORD_STATUS_URL = '/table/{tableId}/record/{recordId}/status';

export const recordStatusVoSchema = z.object({
  isVisible: z.boolean(),
  isDeleted: z.boolean(),
});

export type IRecordStatusVo = z.infer<typeof recordStatusVoSchema>;

export const GetRecordStatusRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_RECORD_STATUS_URL,
  description: 'Get record status',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
    query: getRecordsRoSchema,
  },
  responses: {
    200: {
      description: 'List of records',
      content: {
        'application/json': {
          schema: recordStatusVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const getRecordStatus = (
  tableId: string,
  recordId: string,
  query?: IGetRecordsRo
): Promise<AxiosResponse<IRecordStatusVo>> => {
  const serializedQuery = {
    ...query,
    filter: query?.filter ? JSON.stringify(query.filter) : undefined,
    orderBy: query?.orderBy ? JSON.stringify(query.orderBy) : undefined,
    groupBy: query?.groupBy ? JSON.stringify(query.groupBy) : undefined,
  };

  return axios.get<IRecordStatusVo>(urlBuilder(GET_RECORD_STATUS_URL, { tableId, recordId }), {
    params: serializedQuery,
  });
};
