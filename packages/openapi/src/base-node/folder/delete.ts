import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const DELETE_BASE_NODE_FOLDER = '/base/{baseId}/node/folder/{folderId}';

export const DeleteBaseNodeFolderRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_BASE_NODE_FOLDER,
  description: 'Delete a node folder and move its children to parent',
  request: {
    params: z.object({
      baseId: z.string(),
      folderId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted folder node (for client side cleanup)',
    },
  },
  tags: ['base node'],
});

export const deleteBaseNodeFolder = async (baseId: string, folderId: string) => {
  return axios.delete(urlBuilder(DELETE_BASE_NODE_FOLDER, { baseId, folderId }));
};
