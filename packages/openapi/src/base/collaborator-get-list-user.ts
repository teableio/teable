import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const BASE_COLLABORATE_LIST_USER = '/base/{baseId}/collaborators/users';

export const listBaseCollaboratorUserRoSchema = z.object({
  search: z.string().optional(),
  skip: z.coerce.number().optional(),
  take: z.coerce.number().optional(),
  includeSystem: z.coerce.boolean().optional(),
  orderBy: z.enum(['desc', 'asc']).optional(),
});

export type IListBaseCollaboratorUserRo = z.infer<typeof listBaseCollaboratorUserRoSchema>;

export const itemBaseCollaboratorUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatar: z.string().nullable().optional(),
});

export type IItemBaseCollaboratorUser = z.infer<typeof itemBaseCollaboratorUserSchema>;

export const listBaseCollaboratorUserVoSchema = z.object({
  users: z.array(itemBaseCollaboratorUserSchema),
  total: z.number(),
});

export type IListBaseCollaboratorUserVo = z.infer<typeof listBaseCollaboratorUserVoSchema>;

export const ListBaseCollaboratorUserRoute: RouteConfig = registerRoute({
  method: 'get',
  title: 'List project collaborator users',
  summary: 'Get project collaborator user list',
  description: 'List the user accounts that collaborate on a project.',
  path: BASE_COLLABORATE_LIST_USER,
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: listBaseCollaboratorUserRoSchema,
  },
  responses: {
    200: {
      description: 'Successful response, return project collaborator user list.',
      content: {
        'application/json': {
          schema: listBaseCollaboratorUserVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const getUserCollaborators = async (
  baseId: string,
  options?: IListBaseCollaboratorUserRo
) => {
  return axios.get<IListBaseCollaboratorUserVo>(
    urlBuilder(BASE_COLLABORATE_LIST_USER, { baseId }),
    {
      params: options,
    }
  );
};
