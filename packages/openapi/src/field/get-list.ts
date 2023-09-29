import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldVo, IGetFieldsQuery } from '@teable-group/core';
import { fieldVoSchema, getFieldsQuerySchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_FIELD_LIST = '/tableId/{tableId}/field';

export const GetFieldListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_FIELD_LIST,
  description: 'Get field list by query',
  request: {
    params: getFieldsQuerySchema,
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

export const getFieldList = async (tableId: string, query: IGetFieldsQuery) => {
  return axios.get<IFieldVo[]>(urlBuilder(GET_FIELD_LIST, { params: { tableId }, query }));
};
