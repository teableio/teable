import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { fieldKeyTypeRoSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { tableListVoSchema } from './create';

export type ITableListVo = z.infer<typeof tableListVoSchema>;

export const getTableQuerySchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View).optional().openapi({
    description: 'Which view to get the data from.',
  }),
  includeContent: z
    .string()
    .or(z.boolean())
    .transform(Boolean)
    .pipe(z.boolean())
    .optional()
    .openapi({
      description: 'If true return table content. including fields, views, first 50 records.',
    }),
  fieldKeyType: fieldKeyTypeRoSchema,
});

export type IGetTableQuery = z.infer<typeof getTableQuerySchema>;

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

export const getTableList = async (baseId: string, params?: IGetTableQuery) => {
  return axios.get<ITableListVo>(urlBuilder(GET_TABLE_LIST, { baseId }), { params });
};
