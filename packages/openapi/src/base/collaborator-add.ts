import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { baseRolesSchema } from '@teable/core';
import { axios } from '../axios';
import { addCollaboratorSchema } from '../space/collaborator-add';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const ADD_BASE_COLLABORATOR = '/base/{baseId}/collaborator';

export const addBaseCollaboratorRoSchema = z.object({
  collaborators: z.array(addCollaboratorSchema),
  role: baseRolesSchema,
});

export type AddBaseCollaboratorRo = z.infer<typeof addBaseCollaboratorRoSchema>;

export const AddBaseCollaboratorRoute: RouteConfig = registerRoute({
  method: 'post',
  path: ADD_BASE_COLLABORATOR,
  description: 'Add a collaborator to a base',
  request: {
    params: z.object({ baseId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: addBaseCollaboratorRoSchema,
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

export const addBaseCollaborator = async (baseId: string, collaborator: AddBaseCollaboratorRo) => {
  return axios.post(urlBuilder(ADD_BASE_COLLABORATOR, { baseId }), collaborator);
};
