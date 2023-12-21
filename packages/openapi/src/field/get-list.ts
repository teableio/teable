import type { IFieldVo, IGetFieldsQuery } from '@teable-group/core';
import { fieldVoSchema, getFieldsQuerySchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const GET_FIELD_LIST = '/table/{tableId}/field';

export const GetFieldListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_FIELD_LIST,
  description: 'Get field list by query',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: getFieldsQuerySchema,
  },
  responses: {
    200: {
      description: 'Returns the list of field.',
      content: {
        'application/json': {
          schema: z.array(fieldVoSchema),
        },
      },
    },
  },
  tags: ['field'],
});

export const getFields = async (tableId: string, query: IGetFieldsQuery) => {
  return axios.get<IFieldVo[]>(urlBuilder(GET_FIELD_LIST, { tableId }), { params: query });
};
