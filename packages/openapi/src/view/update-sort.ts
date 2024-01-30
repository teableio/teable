import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { sortSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_SORT = '/table/{tableId}/view/{viewId}/sort';

export const viewSortRoSchema = z.object({
  sort: sortSchema,
});

export type IViewSortRo = z.infer<typeof viewSortRoSchema>;

export const updateViewSortRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_SORT,
  description: 'Update view sort condition',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: sortSchema,
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

export const updateViewSort = async (tableId: string, viewId: string, sortViewRo: IViewSortRo) => {
  return axios.put<void>(
    urlBuilder(VIEW_SORT, {
      tableId,
      viewId,
    }),
    sortViewRo
  );
};
