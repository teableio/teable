import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_BASE_COLLABORATOR = '/base/{baseId}/collaborators';

export const DeleteBaseCollaboratorRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_BASE_COLLABORATOR,
  description: 'Delete a base collaborators',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: z.object({
      userId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successful response.',
    },
  },
  tags: ['base'],
});

export const deleteBaseCollaborator = (params: { baseId: string; userId: string }) => {
  const { baseId, userId } = params;
  return axios.delete(urlBuilder(DELETE_BASE_COLLABORATOR, { baseId }), { params: { userId } });
};
