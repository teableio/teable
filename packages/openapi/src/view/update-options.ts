import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { viewOptionsSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_OPTION = '/table/{tableId}/view/{viewId}/options';

export const viewOptionsRoSchema = z.object({
  options: viewOptionsSchema,
});

export type IViewOptionsRo = z.infer<typeof viewOptionsRoSchema>;

export const UpdateViewOptionsRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: VIEW_OPTION,
  description: 'Update view option',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: viewOptionsRoSchema,
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

export const updateViewOptions = async (
  tableId: string,
  viewId: string,
  viewOptionsRo: IViewOptionsRo
) => {
  return axios.patch<void>(
    urlBuilder(VIEW_OPTION, {
      tableId,
      viewId,
    }),
    viewOptionsRo
  );
};
