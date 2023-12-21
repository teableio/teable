import type { IViewOptionRo } from '@teable-group/core';
import { viewOptionRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const VIEW_OPTION = '/table/{tableId}/view/{viewId}/option';

export const SetViewShortRoute: RouteConfig = registerRoute({
  method: 'put',
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
          schema: viewOptionRoSchema,
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

export const setViewOption = async (
  tableId: string,
  viewId: string,
  viewOptionRo: IViewOptionRo
) => {
  return axios.put<void>(
    urlBuilder(VIEW_OPTION, {
      tableId,
      viewId,
    }),
    viewOptionRo
  );
};
