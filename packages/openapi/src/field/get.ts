import type { IFieldVo } from '@teable-group/core';
import { fieldVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const GET_FIELD = '/table/{tableId}/field/{fieldId}';

export const GetFieldRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_FIELD,
  description: 'Get a field',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about a field.',
      content: {
        'application/json': {
          schema: fieldVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const getField = async (tableId: string, fieldId: string) => {
  return axios.get<IFieldVo>(
    urlBuilder(GET_FIELD, {
      tableId,
      fieldId,
    })
  );
};
