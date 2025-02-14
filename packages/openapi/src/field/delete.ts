import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_FIELD = '/table/{tableId}/field/{fieldId}';

export const DeleteFieldRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_FIELD,
  summary: 'Delete field',
  description: 'Permanently remove a field from the specified table',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['field'],
});

export const deleteField = async (tableId: string, fieldId: string) => {
  return axios.delete<null>(
    urlBuilder(DELETE_FIELD, {
      tableId,
      fieldId,
    })
  );
};
