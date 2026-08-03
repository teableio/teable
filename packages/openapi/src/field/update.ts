import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IUpdateFieldRo } from '@teable/core';
import { updateFieldRoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_FIELD = '/table/{tableId}/field/{fieldId}';

export const UpdateFieldRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_FIELD,
  summary: 'Update field',
  description:
    'Update common properties of a field (name, description, dbFieldName). For other property changes, use the convert field API',
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
      description: 'Updated Successfully',
    },
  },
  tags: ['field'],
});

export const updateField = async (tableId: string, fieldId: string, fieldRo: IUpdateFieldRo) => {
  return axios.patch(
    urlBuilder(UPDATE_FIELD, {
      tableId,
      fieldId,
    }),
    fieldRo
  );
};
