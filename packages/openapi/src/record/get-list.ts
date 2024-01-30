import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IGetRecordsRo, IRecordsVo } from '@teable/core';
import { getRecordsRoSchema, recordsVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_RECORDS_URL = '/table/{tableId}/record';

export const GetRecordsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_RECORDS_URL,
  description: 'List of records',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: getRecordsRoSchema,
  },
  responses: {
    200: {
      description: 'List of records',
      content: {
        'application/json': {
          schema: recordsVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const getRecords = async (tableId: string, query?: IGetRecordsRo) => {
  return axios.get<IRecordsVo>(
    urlBuilder(GET_RECORDS_URL, {
      tableId,
    }),
    {
      params: {
        ...query,
        filter: JSON.stringify(query?.filter),
        orderBy: JSON.stringify(query?.orderBy),
        groupBy: JSON.stringify(query?.groupBy),
      },
    }
  );
};
