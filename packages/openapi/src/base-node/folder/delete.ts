import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const DELETE_BASE_NODE_FOLDER = '/base/{baseId}/node/folder/{folderId}';

export const DeleteBaseNodeFolderRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_BASE_NODE_FOLDER,
  title: 'Delete project folder',
  description:
    'Move a folder and everything in it to the trash, the same as deleting its node. The folder ID or its node ID works.',
  request: {
    params: z.object({
      baseId: z.string(),
      folderId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'The deleted folder node (for client side cleanup)',
    },
  },
  tags: ['base node'],
});

export const deleteBaseNodeFolder = async (baseId: string, folderId: string) => {
  return axios.delete(urlBuilder(DELETE_BASE_NODE_FOLDER, { baseId, folderId }));
};
