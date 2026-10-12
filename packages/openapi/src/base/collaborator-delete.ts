import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { deleteSpaceCollaboratorRoSchema } from '../space';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_BASE_COLLABORATOR = '/base/{baseId}/collaborators';

export const deleteBaseCollaboratorRoSchema = deleteSpaceCollaboratorRoSchema;

export type DeleteBaseCollaboratorRo = z.infer<typeof deleteBaseCollaboratorRoSchema>;

export const DeleteBaseCollaboratorRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_BASE_COLLABORATOR,
  title: 'Remove project collaborator',
  description: 'Remove the specified user or department from a project.',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: deleteBaseCollaboratorRoSchema,
  },
  responses: {
    200: {
      description: 'Successful response.',
    },
  },
  tags: ['base'],
});

export const deleteBaseCollaborator = (params: {
  baseId: string;
  deleteBaseCollaboratorRo: DeleteBaseCollaboratorRo;
}) => {
  const { baseId, deleteBaseCollaboratorRo } = params;
  return axios.delete(urlBuilder(DELETE_BASE_COLLABORATOR, { baseId }), {
    params: deleteBaseCollaboratorRo,
  });
};
