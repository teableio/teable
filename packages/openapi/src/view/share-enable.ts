import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const ENABLE_SHARE_VIEW = '/table/{tableId}/view/{viewId}/enableShare';

export const enableShareViewVoSchema = z.object({
  shareId: z.string(),
});

export type EnableShareViewVo = z.infer<typeof enableShareViewVoSchema>;

export const EnableShareViewRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: ENABLE_SHARE_VIEW,
  description: 'Enable view share',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns successfully enable view share',
      content: {
        'application/json': {
          schema: enableShareViewVoSchema,
        },
      },
    },
  },
  tags: ['view'],
});

export const enableShareView = (params: { tableId: string; viewId: string }) => {
  return axios.patch<EnableShareViewVo>(urlBuilder(ENABLE_SHARE_VIEW, params));
};
