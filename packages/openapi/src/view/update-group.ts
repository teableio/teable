import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IViewGroupRo } from '@teable/core';
import { groupSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_GROUP = '/table/{tableId}/view/{viewId}/group';

export const UpdateViewGroupRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_GROUP,
  description: 'Update view group condition',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: groupSchema,
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

export const updateViewGroup = async (
  tableId: string,
  viewId: string,
  groupViewRo: IViewGroupRo
) => {
  return axios.put<void>(
    urlBuilder(VIEW_GROUP, {
      tableId,
      viewId,
    }),
    groupViewRo
  );
};
