import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { ResourceType } from '../types';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SPACE_SEARCH = '/space/{spaceId}/search';

export const spaceSearchRoSchema = z.object({
  type: z.enum(ResourceType).optional(),
  search: z.string().min(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().optional(),
});

export type ISpaceSearchRo = z.infer<typeof spaceSearchRoSchema>;

export const spaceSearchItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(ResourceType),
  icon: z.string().nullable(),
  baseId: z.string(),
  baseName: z.string(),
  createdTime: z.string(),
  createdUser: z
    .object({
      id: z.string(),
      name: z.string(),
      avatar: z.string().nullable(),
    })
    .optional(),
});

export const spaceSearchVoSchema = z.object({
  list: z.array(spaceSearchItemSchema),
  total: z.number(),
  nextCursor: z.string().nullable(),
});

export type ISpaceSearchItem = z.infer<typeof spaceSearchItemSchema>;
export type ISpaceSearchVo = z.infer<typeof spaceSearchVoSchema>;

export const SpaceSearchRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SPACE_SEARCH,
  description: 'Search bases and nodes within a space',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    query: spaceSearchRoSchema,
  },
  responses: {
    200: {
      description: 'Returns the search results.',
      content: {
        'application/json': {
          schema: spaceSearchVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const spaceSearch = async (spaceId: string, query: ISpaceSearchRo) => {
  return axios.get<ISpaceSearchVo>(urlBuilder(SPACE_SEARCH, { spaceId }), { params: query });
};
