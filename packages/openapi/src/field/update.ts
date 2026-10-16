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
    'Patch field properties. On v2, also patch unique/notNull constraints, the options supported by the current field type, its lookup/link configuration, or audit trackedFieldIds. Patched options must be valid for the current field type; unsupported ones are rejected. An empty trackedFieldIds array tracks all editable fields. Field type changes, and constraint/option updates on v1, use the conversion endpoint.',
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
