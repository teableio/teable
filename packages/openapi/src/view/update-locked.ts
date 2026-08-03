import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_LOCKED = '/table/{tableId}/view/{viewId}/locked';

export const viewLockedRoSchema = z.object({
  isLocked: z.boolean().optional(),
});

export type IViewLockedRo = z.infer<typeof viewLockedRoSchema>;

export const updateViewLockedRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_LOCKED,
  description: 'Update the locked status of the view',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: viewLockedRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['view'],
});

export const updateViewLocked = async (tableId: string, viewId: string, data: IViewLockedRo) => {
  return axios.put<void>(
    urlBuilder(VIEW_LOCKED, {
      tableId,
      viewId,
    }),
    data
  );
};
