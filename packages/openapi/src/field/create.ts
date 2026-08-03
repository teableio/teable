import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { createFieldRoSchema, fieldVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const CREATE_FIELD = '/table/{tableId}/field';

export const CreateFieldRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_FIELD,
  summary: 'Create field',
  description: 'Create a new field in the specified table with the given configuration',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createFieldRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
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

export const createField = async (tableId: string, fieldRo: IFieldRo) => {
  return axios.post<IFieldVo>(urlBuilder(CREATE_FIELD, { tableId }), fieldRo);
};
