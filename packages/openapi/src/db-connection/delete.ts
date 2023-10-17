import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_DB_CONNECTION = '/base/{baseId}/connection';

export const DeleteDbConnectionRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_DB_CONNECTION,
  description: 'Delete a db connection',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['db-connection'],
});

export const deleteDbConnection = async (baseId: string) => {
  return axios.delete<null>(
    urlBuilder(DELETE_DB_CONNECTION, {
      baseId,
    })
  );
};
