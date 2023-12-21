import { spaceRolesSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const UPDATE_SPACE_COLLABORATE = '/space/{spaceId}/collaborators';

export const updateSpaceCollaborateRoSchema = z.object({
  userId: z.string(),
  role: spaceRolesSchema,
});

export type UpdateSpaceCollaborateRo = z.infer<typeof updateSpaceCollaborateRoSchema>;

export const UpdateSpaceCollaborateRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_SPACE_COLLABORATE,
  description: 'Update a space collaborator',
  request: {
    params: z.object({
      invitationId: z.string(),
      spaceId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateSpaceCollaborateRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successful response.',
    },
  },
  tags: ['space'],
});

export const updateSpaceCollaborator = async (params: {
  spaceId: string;
  updateSpaceCollaborateRo: UpdateSpaceCollaborateRo;
}) => {
  const { spaceId, updateSpaceCollaborateRo } = params;
  return axios.patch<void>(
    urlBuilder(UPDATE_SPACE_COLLABORATE, {
      spaceId,
    }),
    updateSpaceCollaborateRo
  );
};
