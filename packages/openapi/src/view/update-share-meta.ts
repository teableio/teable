import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { shareViewMetaSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_SHARE_META = '/table/{tableId}/view/{viewId}/share-meta';

export const viewShareMetaRoSchema = shareViewMetaSchema;

export type IViewShareMetaRo = z.infer<typeof viewShareMetaRoSchema>;

export const updateViewShareMetaRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_SHARE_META,
  description: 'Update view share meta',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: viewShareMetaRoSchema,
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

export const updateViewShareMeta = async (
  tableId: string,
  viewId: string,
  shareMeta: IViewShareMetaRo
) => {
  return axios.put<void>(
    urlBuilder(VIEW_SHARE_META, {
      tableId,
      viewId,
    }),
    shareMeta
  );
};
