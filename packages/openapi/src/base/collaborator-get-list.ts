import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { collaboratorItem } from '../space/types';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const BASE_COLLABORATE_LIST = '/base/{baseId}/collaborators';

export const itemBaseCollaboratorSchema = collaboratorItem;

export const listBaseCollaboratorRoSchema = z.object({
  includeSystem: z.coerce.boolean().optional(),
  skip: z.coerce.number().optional(),
  take: z.coerce.number().optional(),
  search: z.string().optional(),
});

export type ListBaseCollaboratorRo = z.infer<typeof listBaseCollaboratorRoSchema>;

export type ItemBaseCollaborator = z.infer<typeof itemBaseCollaboratorSchema>;

export const listBaseCollaboratorVoSchema = z.object({
  collaborators: z.array(itemBaseCollaboratorSchema),
  total: z.number(),
});

export type ListBaseCollaboratorVo = z.infer<typeof listBaseCollaboratorVoSchema>;

export const ListBaseCollaboratorRoute: RouteConfig = registerRoute({
  method: 'get',
  path: BASE_COLLABORATE_LIST,
  description: 'List a base collaborator',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: listBaseCollaboratorRoSchema,
  },
  responses: {
    200: {
      description: 'Successful response, return base collaborator list.',
      content: {
        'application/json': {
          schema: listBaseCollaboratorVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const getBaseCollaboratorList = async (baseId: string, options?: ListBaseCollaboratorRo) => {
  return axios.get<ListBaseCollaboratorVo>(
    urlBuilder(BASE_COLLABORATE_LIST, {
      baseId,
    }),
    { params: options }
  );
};
