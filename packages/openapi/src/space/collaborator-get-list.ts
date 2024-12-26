import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { collaboratorItem } from './types';

export const SPACE_COLLABORATE_LIST = '/space/{spaceId}/collaborators';

export const listSpaceCollaboratorRoSchema = z.object({
  includeSystem: z.coerce.boolean().optional(),
  includeBase: z.coerce.boolean().optional(),
  skip: z.coerce.number().optional(),
  take: z.coerce.number().optional(),
  search: z.string().optional(),
});

export type ListSpaceCollaboratorRo = z.infer<typeof listSpaceCollaboratorRoSchema>;

export type ItemSpaceCollaboratorVo = z.infer<typeof collaboratorItem>;

export const listSpaceCollaboratorVoSchema = z.object({
  collaborators: z.array(collaboratorItem),
  total: z.number(),
});

export type ListSpaceCollaboratorVo = z.infer<typeof listSpaceCollaboratorVoSchema>;

export const ListSpaceCollaboratorRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SPACE_COLLABORATE_LIST,
  description: 'List a space collaborator',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    query: listSpaceCollaboratorRoSchema,
  },
  responses: {
    200: {
      description: 'Successful response, return space collaborator list.',
      content: {
        'application/json': {
          schema: listSpaceCollaboratorVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const getSpaceCollaboratorList = async (
  spaceId: string,
  query?: ListSpaceCollaboratorRo
) => {
  return axios.get<ListSpaceCollaboratorVo>(
    urlBuilder(SPACE_COLLABORATE_LIST, {
      spaceId,
    }),
    {
      params: query,
    }
  );
};
