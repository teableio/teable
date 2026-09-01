import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { PrincipalType } from './types';

export const DELETE_SPACE_COLLABORATOR = '/space/{spaceId}/collaborators';

export const deleteSpaceCollaboratorRoSchema = z.object({
  principalId: z.string(),
  principalType: z.enum(PrincipalType),
});

export type DeleteSpaceCollaboratorRo = z.infer<typeof deleteSpaceCollaboratorRoSchema>;

export const DeleteSpaceCollaboratorRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_SPACE_COLLABORATOR,
  description: 'Delete a collaborator',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    query: deleteSpaceCollaboratorRoSchema,
  },
  responses: {
    200: {
      description: 'Successful response.',
    },
  },
  tags: ['space'],
});

export const deleteSpaceCollaborator = (params: {
  spaceId: string;
  deleteSpaceCollaboratorRo: DeleteSpaceCollaboratorRo;
}) => {
  const { spaceId, deleteSpaceCollaboratorRo } = params;
  return axios.delete(urlBuilder(DELETE_SPACE_COLLABORATOR, { spaceId }), {
    params: deleteSpaceCollaboratorRo,
  });
};

export const DELETE_SPACE_BASE_COLLABORATORS = '/space/{spaceId}/collaborators/base';

export const DeleteSpaceBaseCollaboratorsRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_SPACE_BASE_COLLABORATORS,
  description: "Delete all of a principal's base-level collaborator rows within the space",
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    query: deleteSpaceCollaboratorRoSchema,
  },
  responses: {
    200: {
      description: 'Successful response.',
    },
  },
  tags: ['space'],
});

export const deleteSpaceBaseCollaborators = (params: {
  spaceId: string;
  deleteSpaceCollaboratorRo: DeleteSpaceCollaboratorRo;
}) => {
  const { spaceId, deleteSpaceCollaboratorRo } = params;
  return axios.delete(urlBuilder(DELETE_SPACE_BASE_COLLABORATORS, { spaceId }), {
    params: deleteSpaceCollaboratorRo,
  });
};
