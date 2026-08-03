import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const REFRESH_SHARE_ID = '/table/{tableId}/view/{viewId}/refresh-share-id';

export const refreshShareViewVoSchema = z.object({
  shareId: z.string(),
});

export const refreshViewShareIdRoute: RouteConfig = registerRoute({
  method: 'post',
  path: REFRESH_SHARE_ID,
  description: 'Refresh view share id',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Returns successfully refreshed view share id',
      content: {
        'application/json': {
          schema: refreshShareViewVoSchema,
        },
      },
    },
  },
  tags: ['view'],
});

export const refreshViewShareId = async (tableId: string, viewId: string) => {
  return axios.post<void>(
    urlBuilder(REFRESH_SHARE_ID, {
      tableId,
      viewId,
    })
  );
};
