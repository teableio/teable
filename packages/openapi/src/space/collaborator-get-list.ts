import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { spaceRolesSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SPACE_COLLABORATE_LIST = '/space/{spaceId}/collaborators';

export const itemSpaceCollaboratorSchema = z.object({
  userId: z.string(),
  username: z.string(),
  email: z.string(),
  role: spaceRolesSchema,
  avatar: z.string().nullable(),
  createdTime: z.string(),
});

export type ItemSpaceCollaboratorVo = z.infer<typeof itemSpaceCollaboratorSchema>;

export const listSpaceCollaboratorVoSchema = z.array(itemSpaceCollaboratorSchema);

export type ListSpaceCollaboratorVo = z.infer<typeof listSpaceCollaboratorVoSchema>;

export const ListSpaceCollaboratorRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SPACE_COLLABORATE_LIST,
  description: 'List a space collaborator',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
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

export const getSpaceCollaboratorList = async (spaceId: string) => {
  return axios.get<ListSpaceCollaboratorVo>(
    urlBuilder(SPACE_COLLABORATE_LIST, {
      spaceId,
    })
  );
};
