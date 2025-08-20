import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { CollaboratorItem, DepartmentCollaboratorItem, UserCollaboratorItem } from './types';
import { collaboratorItem, PrincipalType } from './types';

export const SPACE_COLLABORATE_LIST = '/space/{spaceId}/collaborators';

export const listSpaceCollaboratorRoSchema = z.object({
  includeSystem: z.coerce.boolean().optional(),
  includeBase: z.coerce.boolean().optional(),
  skip: z.coerce.number().optional(),
  take: z.coerce.number().optional(),
  search: z.string().optional(),
  type: z.nativeEnum(PrincipalType).optional(),
  orderBy: z.enum(['desc', 'asc']).optional(),
});

export type ListSpaceCollaboratorRo = z.infer<typeof listSpaceCollaboratorRoSchema>;

export type ItemSpaceCollaboratorVo = z.infer<typeof collaboratorItem>;

export const listSpaceCollaboratorVoSchema = z.object({
  collaborators: z.array(collaboratorItem),
  uniqTotal: z.number(),
  total: z.number(),
});

export type ListSpaceCollaboratorVo = z.infer<typeof listSpaceCollaboratorVoSchema>;

type GetFilteredCollaborator<T extends { type?: PrincipalType }> = T extends {
  type: PrincipalType.User;
}
  ? Extract<UserCollaboratorItem, { type: PrincipalType.User }>
  : T extends { type: PrincipalType.Department }
    ? Extract<DepartmentCollaboratorItem, { type: PrincipalType.Department }>
    : CollaboratorItem;

export type IGetCollaboratorsResponse<T extends { type?: PrincipalType } = object> = Omit<
  ListSpaceCollaboratorVo,
  'collaborators'
> & {
  collaborators: GetFilteredCollaborator<T>[];
  total: number;
};

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

export const getSpaceCollaboratorList = async <T extends ListSpaceCollaboratorRo>(
  spaceId: string,
  query?: ListSpaceCollaboratorRo
) => {
  return axios.get<IGetCollaboratorsResponse<T>>(
    urlBuilder(SPACE_COLLABORATE_LIST, {
      spaceId,
    }),
    {
      params: query,
    }
  );
};
