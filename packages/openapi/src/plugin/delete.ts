import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_PLUGIN = '/plugin/{id}';

export const deletePluginRoSchema = z.object({
  id: z.string(),
});

export type IDeletePluginRo = z.infer<typeof deletePluginRoSchema>;

export const DeletePluginRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_PLUGIN,
  description: 'Delete a plugin',
  request: {
    params: deletePluginRoSchema,
  },
  responses: {
    200: {
      description: 'Returns no content.',
    },
  },
  tags: ['plugin'],
});

export const deletePlugin = async (id: string) => {
  return axios.delete<void>(urlBuilder(DELETE_PLUGIN, { id }));
};
