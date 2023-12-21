import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const DELETE_SPACE_COLLABORATOR = '/space/{spaceId}/collaborators';

export const DeleteSpaceCollaboratorRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_SPACE_COLLABORATOR,
  description: 'Delete a collaborator',
  request: {
    params: z.object({
      spaceId: z.string(),
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
  tags: ['space'],
});

export const deleteSpaceCollaborator = (params: { spaceId: string; userId: string }) => {
  const { spaceId, userId } = params;
  return axios.delete(urlBuilder(DELETE_SPACE_COLLABORATOR, { spaceId }), { params: { userId } });
};
