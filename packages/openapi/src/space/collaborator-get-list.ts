import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { roleSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SPACE_COLLABORATE_LIST = '/space/{spaceId}/collaborators';

export enum CollaboratorType {
  Space = 'space',
  Base = 'base',
}

export const itemSpaceCollaboratorSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  email: z.string(),
  role: roleSchema,
  avatar: z.string().nullable(),
  createdTime: z.string(),
  base: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
});

export const listSpaceCollaboratorRoSchema = z.object({
  includeSystem: z.boolean().optional(),
  includeBase: z.boolean().optional(),
});

export type ListSpaceCollaboratorRo = z.infer<typeof listSpaceCollaboratorRoSchema>;

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
