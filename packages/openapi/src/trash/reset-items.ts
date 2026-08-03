import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import type { z } from '../zod';
import { trashItemsRoSchema } from './get-items';

export const RESET_TRASH_ITEMS = '/trash/reset-items';

export const resetTrashItemsRoSchema = trashItemsRoSchema;

export type IResetTrashItemsRo = z.infer<typeof resetTrashItemsRoSchema>;

export const ResetTrashItemsRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: RESET_TRASH_ITEMS,
  description: 'Reset trash items for a base or table',
  request: {
    query: resetTrashItemsRoSchema,
  },
  responses: {
    200: {
      description: 'Reset successfully',
    },
  },
  tags: ['base'],
});

export const resetTrashItems = async (resetTrashItemsRo: IResetTrashItemsRo) => {
  return axios.delete<null>(RESET_TRASH_ITEMS, { params: resetTrashItemsRo });
};
