import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { ITrashVo } from './get';
import { ResourceType, trashVoSchema } from './get';

export const GET_TRASH_ITEMS = '/trash/items';

export const trashItemsRoSchema = z.object({
  resourceId: z.string(),
  resourceType: z.enum([ResourceType.Base, ResourceType.Table]),
  cursor: z.string().nullish(),
});

export type ITrashItemsRo = z.infer<typeof trashItemsRoSchema>;

export const GetTrashItemsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TRASH_ITEMS,
  description: 'Get trash items for base or table',
  request: {
    query: trashItemsRoSchema,
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

export const getTrashItems = (trashItemsRo: ITrashItemsRo) => {
  return axios.get<ITrashVo>(GET_TRASH_ITEMS, { params: trashItemsRo });
};
