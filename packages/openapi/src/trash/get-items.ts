import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import {
  createStringOrArrayQuerySchema,
  registerRoute,
  serializeArrayAwareQuery,
  stringOrArrayQuerySchema,
} from '../utils';
import { z } from '../zod';
import type { ITrashVo } from './get';
import { trashVoSchema } from './get';
import { TableTrashType, TrashType } from './types';

export const GET_TRASH_ITEMS = '/trash/items';

export const tableTrashResourceTypesQuerySchema = createStringOrArrayQuerySchema(
  z.nativeEnum(TableTrashType)
);

export const trashItemsRoSchema = z.object({
  resourceId: z.string(),
  resourceType: z.enum([TrashType.Base, TrashType.Table]),
  cursor: z.string().nullish(),
  pageSize: z.coerce.number().int().min(1).max(20).default(20).optional(),
  // Filters below only apply to resourceType=Table; the Base branch ignores them.
  resourceTypes: tableTrashResourceTypesQuerySchema,
  deletedBy: stringOrArrayQuerySchema,
  deletedTimeStart: z.string().optional(),
  deletedTimeEnd: z.string().optional(),
});

export type ITrashItemsRo = z.infer<typeof trashItemsRoSchema>;

export type ITableTrashItemsFilter = Pick<
  ITrashItemsRo,
  'resourceTypes' | 'deletedBy' | 'deletedTimeStart' | 'deletedTimeEnd'
>;

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
  return axios.get<ITrashVo>(GET_TRASH_ITEMS, {
    params: trashItemsRo,
    paramsSerializer: serializeArrayAwareQuery,
  });
};
