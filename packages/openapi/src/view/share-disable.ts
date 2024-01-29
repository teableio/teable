import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DISABLE_SHARE_VIEW = '/table/{tableId}/view/{viewId}/disable-share';

export const DisableShareViewRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DISABLE_SHARE_VIEW,
  description: 'Disable view share',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Returns successfully disable view share',
    },
  },
  tags: ['view'],
});

export const disableShareView = (params: { tableId: string; viewId: string }) => {
  return axios.post<void>(urlBuilder(DISABLE_SHARE_VIEW, params));
};
