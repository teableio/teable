import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const ENABLE_SHARE_VIEW = '/table/{tableId}/view/{viewId}/enable-share';

export const enableShareViewVoSchema = z.object({
  shareId: z
    .string()
    .describe(
      'The share id of the view. Use it to access the shared view at `${endpoint}/share/{shareId}/view` (e.g. https://app.teable.ai/share/shrH7kunpHv8U9kfZyD/view).'
    ),
});

export type IEnableShareViewVo = z.infer<typeof enableShareViewVoSchema>;

export const EnableShareViewRoute: RouteConfig = registerRoute({
  method: 'post',
  path: ENABLE_SHARE_VIEW,
  description: 'Enable view share',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
  },
  responses: {
    201: {
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
  const { tableId, viewId } = params;
  return axios.post<IEnableShareViewVo>(urlBuilder(ENABLE_SHARE_VIEW, { tableId, viewId }));
};
