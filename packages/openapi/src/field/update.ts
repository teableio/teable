import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldVo, IUpdateFieldRo } from '@teable-group/core';
import { updateFieldRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_FIELD = '/table/{tableId}/field/{fieldId}';

export const UpdateFieldRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_FIELD,
  description:
    'Update the field name, description or dbFieldName. for other properties, you should use the convert field api',
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
  return axios.patch<IFieldVo>(
    urlBuilder(UPDATE_FIELD, {
      tableId,
      fieldId,
    }),
    fieldRo
  );
};
