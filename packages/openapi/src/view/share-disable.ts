import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const DISABLE_SHARE_VIEW = '/table/{tableId}/view/{viewId}/disableShare';

export const DisableShareViewRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: DISABLE_SHARE_VIEW,
  description: 'Disable view share',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns successfully disable view share',
    },
  },
  tags: ['view'],
});

export const disableShareView = (params: { tableId: string; viewId: string }) => {
  return axios.patch<void>(urlBuilder(DISABLE_SHARE_VIEW, params));
};
