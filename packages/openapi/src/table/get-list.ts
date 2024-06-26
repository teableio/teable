import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { tableListVoSchema } from './create';

export type ITableListVo = z.infer<typeof tableListVoSchema>;

export const GET_TABLE_LIST = '/base/{baseId}/table';

export const GetTableListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TABLE_LIST,
  description: 'Get table list',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the list of table.',
      content: {
        'application/json': {
          schema: tableListVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const getTableList = async (baseId: string) => {
  return axios.get<ITableListVo>(urlBuilder(GET_TABLE_LIST, { baseId }));
};
