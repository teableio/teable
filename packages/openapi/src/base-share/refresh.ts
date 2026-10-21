import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseShareVoSchema } from './types';

export const REFRESH_BASE_SHARE = '/base/{baseId}/share/{shareId}/refresh';

export const RefreshBaseShareRoute: RouteConfig = registerRoute({
  method: 'post',
  path: REFRESH_BASE_SHARE,
  title: 'Refresh project share link',
  description: 'Generate a new ID for a project share link.',
  request: {
    params: z.object({
      baseId: z.string(),
      shareId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the refreshed project share',
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
