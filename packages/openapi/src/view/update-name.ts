import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_NAME = '/table/{tableId}/view/{viewId}/name';

export const viewNameRoSchema = z.object({
  name: z.string(),
});

export type IViewNameRo = z.infer<typeof viewNameRoSchema>;

export const updateViewNameRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_NAME,
  description: 'Update view name',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: viewNameRoSchema,
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

export const updateViewName = async (tableId: string, viewId: string, data: IViewNameRo) => {
  return axios.put<void>(
    urlBuilder(VIEW_NAME, {
      tableId,
      viewId,
    }),
    data
  );
};
