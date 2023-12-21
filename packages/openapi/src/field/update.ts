import type { IFieldVo, IUpdateFieldRo } from '@teable-group/core';
import { fieldVoSchema, updateFieldRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const UPDATE_FIELD = '/table/{tableId}/field/{fieldId}';

export const UpdateFieldRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_FIELD,
  description: 'Update or convert a field',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateFieldRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns field data after update.',
      content: {
        'application/json': {
          schema: fieldVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const updateField = async (tableId: string, fieldId: string, fieldRo: IUpdateFieldRo) => {
  return axios.patch<IFieldVo>(
    urlBuilder(UPDATE_FIELD, {
      tableId,
      fieldId,
    }),
    fieldRo
  );
};
