import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_FIELD_LIST = '/table/{tableId}/field';

export const deleteFieldsQuerySchema = z.object({
  fieldIds: z.array(z.string()),
});

export type IDeleteFieldsQuery = z.infer<typeof deleteFieldsQuerySchema>;

export const DeleteFieldListRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_FIELD_LIST,
  summary: 'Delete multiple fields',
  description: 'Permanently remove multiple fields from the specified table',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: deleteFieldsQuerySchema,
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['field'],
});

export const deleteFields = async (tableId: string, fieldIds: string[]) => {
  return axios.delete<null>(
    urlBuilder(DELETE_FIELD_LIST, {
      tableId,
    }),
    {
      params: {
        fieldIds,
      },
    }
  );
};
