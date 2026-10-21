import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { createFieldRoSchema, fieldVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const CREATE_FIELD = '/table/{tableId}/field';

export const createFieldRequestSchema = z.preprocess((input, ctx) => {
  if (input && typeof input === 'object' && 'isPrimary' in input && input.isPrimary === true) {
    ctx.addIssue({
      code: 'custom',
      path: ['isPrimary'],
      message: 'Cannot create another primary field in an existing table.',
    });
  }
  return input;
}, createFieldRoSchema);

export const CreateFieldRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_FIELD,
  summary: 'Create field',
  description:
    'Create a new field in the specified table. Setting isPrimary to true is rejected; primary fields are established when creating the table.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createFieldRequestSchema,
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
