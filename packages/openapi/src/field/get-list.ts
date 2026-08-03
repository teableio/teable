import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldVo, IGetFieldsQuery } from '@teable/core';
import { fieldVoSchema, getFieldsQuerySchema } from '@teable/core';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_FIELD_LIST = '/table/{tableId}/field';

export const GetFieldListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_FIELD_LIST,
  summary: 'List fields',
  description: 'Retrieve a list of fields in a table with optional filtering',
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

export async function getFields(
  tableId: string,
  query?: IGetFieldsQuery
): Promise<AxiosResponse<IFieldVo[]>> {
  return axios.get<IFieldVo[]>(urlBuilder(GET_FIELD_LIST, { tableId }), {
    params: query,
  });
}
