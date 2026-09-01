import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { roleSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { PrincipalType } from './types';

export const SPACE_COLLABORATE_UNIQUE_LIST = '/space/{spaceId}/collaborators/unique';

export const listSpaceUniqueCollaboratorRoSchema = z.object({
  includeSystem: z.coerce.boolean().optional(),
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(1000).optional(),
  search: z.string().optional(),
  type: z.enum(PrincipalType).optional(),
  orderBy: z.enum(['desc', 'asc']).optional(),
});

export type ListSpaceUniqueCollaboratorRo = z.infer<typeof listSpaceUniqueCollaboratorRoSchema>;

export const uniqueUserCollaboratorItem = z.object({
  type: z.literal(PrincipalType.User),
  userId: z.string(),
  userName: z.string(),
  email: z.string(),
  avatar: z.string().nullable(),
  isSystem: z.boolean().optional(),
  lastSignTime: z.string().nullable().optional(),
  // Null when the principal only holds base-level permissions in this space
  spaceRole: roleSchema.nullable(),
  baseCount: z.number(),
  createdTime: z.string(),
  billable: z.boolean().optional(),
});

export type UniqueUserCollaboratorItem = z.infer<typeof uniqueUserCollaboratorItem>;

export const uniqueDepartmentCollaboratorItem = z.object({
  type: z.literal(PrincipalType.Department),
  departmentId: z.string(),
  departmentName: z.string(),
  spaceRole: roleSchema.nullable(),
  baseCount: z.number(),
  createdTime: z.string(),
});

export type UniqueDepartmentCollaboratorItem = z.infer<typeof uniqueDepartmentCollaboratorItem>;

export const uniqueCollaboratorItem = z.discriminatedUnion('type', [
  uniqueUserCollaboratorItem,
  uniqueDepartmentCollaboratorItem,
]);

export type UniqueCollaboratorItem = z.infer<typeof uniqueCollaboratorItem>;

export const listSpaceUniqueCollaboratorVoSchema = z.object({
  collaborators: z.array(uniqueCollaboratorItem),
  total: z.number(),
});

export type ListSpaceUniqueCollaboratorVo = z.infer<typeof listSpaceUniqueCollaboratorVoSchema>;

export const ListSpaceUniqueCollaboratorRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SPACE_COLLABORATE_UNIQUE_LIST,
  description:
    'List space collaborators deduplicated by principal, with space role and base permission count',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    query: listSpaceUniqueCollaboratorRoSchema,
  },
  responses: {
    200: {
      description: 'Successful response, return unique space collaborator list.',
      content: {
        'application/json': {
          schema: listSpaceUniqueCollaboratorVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const getSpaceUniqueCollaboratorList = async (
  spaceId: string,
  query?: ListSpaceUniqueCollaboratorRo
) => {
  return axios.get<ListSpaceUniqueCollaboratorVo>(
    urlBuilder(SPACE_COLLABORATE_UNIQUE_LIST, {
      spaceId,
    }),
    {
      params: query,
    }
  );
};
