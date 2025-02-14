import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldVo } from '@teable/core';
import { fieldVoSchema } from '@teable/core';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_FIELD = '/table/{tableId}/field/{fieldId}';

export const GetFieldRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_FIELD,
  summary: 'Get a field',
  description: 'Retrieve detailed information about a specific field by its ID',
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

export async function getField(tableId: string, fieldId: string): Promise<AxiosResponse<IFieldVo>> {
  return axios.get<IFieldVo>(urlBuilder(GET_FIELD, { tableId, fieldId }));
}
