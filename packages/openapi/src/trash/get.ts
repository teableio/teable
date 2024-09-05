import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { itemSpaceCollaboratorSchema } from '../space/collaborator-get-list';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const GET_TRASH = '/trash';

export enum ResourceType {
  Space = 'space',
  Base = 'base',
  Table = 'table',
  View = 'view',
  Field = 'field',
  Record = 'record',
}

export const userMapVoSchema = z.record(
  z.string().startsWith(IdPrefix.User),
  itemSpaceCollaboratorSchema
    .pick({
      email: true,
      avatar: true,
    })
    .merge(
      z.object({
        id: z.string(),
        name: z.string(),
      })
    )
);

export const resourceMapVoSchema = z.record(
  z.string(),
  z.union([
    z.object({
      id: z.string().startsWith(IdPrefix.Space),
      name: z.string(),
    }),
    z.object({
      id: z.string().startsWith(IdPrefix.Base),
      spaceId: z.string(),
      name: z.string(),
    }),
    z.object({
      id: z.string().startsWith(IdPrefix.Table),
      name: z.string(),
    }),
  ])
);

export type IResourceMapVo = z.infer<typeof resourceMapVoSchema>;

export const trashRoSchema = z.object({
  resourceType: z.enum([ResourceType.Space, ResourceType.Base]),
});

export type ITrashRo = z.infer<typeof trashRoSchema>;

export const trashItemVoSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  resourceType: z.nativeEnum(ResourceType),
  deletedTime: z.string(),
  deletedBy: z.string(),
});

export type ITrashItemVo = z.infer<typeof trashItemVoSchema>;

export const trashVoSchema = z.object({
  trashItems: z.array(trashItemVoSchema),
  userMap: userMapVoSchema,
  resourceMap: resourceMapVoSchema,
  nextCursor: z.string().nullish(),
});

export type ITrashVo = z.infer<typeof trashVoSchema>;

export const GetTrashRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TRASH,
  description: 'Get trash list for spaces or bases',
  request: {
    query: trashRoSchema,
  },
  responses: {
    200: {
      description: 'Get trash successfully',
      content: {
        'application/json': {
          schema: trashVoSchema,
        },
      },
    },
  },
  tags: ['trash'],
});

export const getTrash = (trashRo: ITrashRo) => {
  return axios.get<ITrashVo>(GET_TRASH, { params: trashRo });
};
