import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { roleSchema } from '@teable/core';
import { axios } from '../axios';
import { PrincipalType } from '../space/types';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const ADD_SPACE_COLLABORATOR = '/space/{spaceId}/collaborator';

export const addCollaboratorSchema = z.object({
  principalId: z.string(),
  principalType: z.nativeEnum(PrincipalType),
});

export type IAddCollaborator = z.infer<typeof addCollaboratorSchema>;

export const addSpaceCollaboratorRoSchema = z.object({
  collaborators: z.array(addCollaboratorSchema),
  role: roleSchema,
});

export type AddSpaceCollaboratorRo = z.infer<typeof addSpaceCollaboratorRoSchema>;

export const AddSpaceCollaboratorRoute: RouteConfig = registerRoute({
  method: 'post',
  path: ADD_SPACE_COLLABORATOR,
  description: 'Add a collaborator to a space',
  request: {
    params: z.object({ spaceId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: addSpaceCollaboratorRoSchema,
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

export const addSpaceCollaborator = async (
  spaceId: string,
  collaborator: AddSpaceCollaboratorRo
) => {
  return axios.post<void>(urlBuilder(ADD_SPACE_COLLABORATOR, { spaceId }), collaborator);
};
