import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseShareVoSchema } from './types';

export const REFRESH_BASE_SHARE = '/base/{baseId}/share/{shareId}/refresh';

export const RefreshBaseShareRoute: RouteConfig = registerRoute({
  method: 'post',
  path: REFRESH_BASE_SHARE,
  description: 'Refresh/regenerate a base share link ID',
  request: {
    params: z.object({
      baseId: z.string(),
      shareId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the refreshed base share',
      content: {
        'application/json': {
          schema: baseShareVoSchema,
        },
      },
    },
  },
  tags: ['base-share'],
});

export const refreshBaseShare = (baseId: string, shareId: string) => {
  return axios.post<z.infer<typeof baseShareVoSchema>>(
    urlBuilder(REFRESH_BASE_SHARE, { baseId, shareId })
  );
};
