import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { baseRolesSchema } from '@teable/core';
import { axios } from '../axios';
import { PrincipalType } from '../space/types';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_BASE_COLLABORATE = '/base/{baseId}/collaborators';

export const updateBaseCollaborateRoSchema = z.object({
  principalId: z.string(),
  principalType: z.nativeEnum(PrincipalType),
  role: baseRolesSchema,
});

export type UpdateBaseCollaborateRo = z.infer<typeof updateBaseCollaborateRoSchema>;

export const UpdateBaseCollaborateRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_BASE_COLLABORATE,
  description: 'Update a base collaborator',
  request: {
    params: z.object({
      invitationId: z.string(),
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateBaseCollaborateRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successful response.',
    },
  },
  tags: ['base'],
});

export const updateBaseCollaborator = async (params: {
  baseId: string;
  updateBaseCollaborateRo: UpdateBaseCollaborateRo;
}) => {
  const { baseId, updateBaseCollaborateRo } = params;
  return axios.patch<void>(
    urlBuilder(UPDATE_BASE_COLLABORATE, {
      baseId,
    }),
    updateBaseCollaborateRo
  );
};
