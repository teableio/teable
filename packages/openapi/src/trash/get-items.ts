import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { ITrashVo } from './get';
import { trashVoSchema } from './get';
import { TrashType } from './types';

export const GET_TRASH_ITEMS = '/trash/items';

export const trashItemsRoSchema = z.object({
  resourceId: z.string(),
  resourceType: z.enum([TrashType.Base, TrashType.Table]),
  cursor: z.string().nullish(),
  pageSize: z.coerce.number().int().min(1).max(20).default(20).optional(),
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
