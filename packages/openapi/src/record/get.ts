import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IGetRecordQuery, IRecord } from '@teable-group/core';
import { getRecordQuerySchema, recordsVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_RECORD_URL = '/table/{tableId}/record/{recordId}';

export const GetRecordRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_RECORD_URL,
  description: 'Get a record',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
    query: getRecordQuerySchema,
  },
  responses: {
    200: {
      description: 'Get a record',
      content: {
        'application/json': {
          schema: recordsVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const getRecord = async (tableId: string, recordId: string, query?: IGetRecordQuery) => {
  return axios.get<IRecord>(
    urlBuilder(GET_RECORD_URL, {
      params: { tableId, recordId },
      query,
    })
  );
};
