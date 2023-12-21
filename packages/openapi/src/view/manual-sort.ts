import type { IManualSortRo, IViewVo } from '@teable-group/core';
import { manualSortRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const VIEW_MANUAL_SORT = '/table/{tableId}/view/{viewId}/sort';

export const ManualSortViewRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_MANUAL_SORT,
  description: 'Update view raw order',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: manualSortRoSchema,
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

export const manualSortView = async (tableId: string, viewId: string, sortRo: IManualSortRo) => {
  return axios.put<IViewVo>(
    urlBuilder(VIEW_MANUAL_SORT, {
      tableId,
      viewId,
    }),
    sortRo
  );
};
