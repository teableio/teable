import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_TRASH = '/trash/{trashId}';

export const DeleteTrashRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_TRASH,
  description: 'Permanently delete a trash item by trashId',
  request: {
    params: z.object({
      trashId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Permanently deleted successfully',
    },
  },
  tags: ['trash'],
});

export const deleteTrash = async (trashId: string) => {
  return await axios.delete<null>(urlBuilder(DELETE_TRASH, { trashId }));
};
