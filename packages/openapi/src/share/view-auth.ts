import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { sharePasswordSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_AUTH = '/share/{shareId}/view/auth';

export const shareViewAuthVoSchema = z.object({
  token: z.string(),
});

export type ShareViewAuthVo = z.infer<typeof shareViewAuthVoSchema>;

export const ShareViewAuthRouter: RouteConfig = registerRoute({
  method: 'post',
  path: SHARE_VIEW_AUTH,
  description: 'share view auth password',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            password: sharePasswordSchema,
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully authenticated',
      content: {
        'application/json': {
          schema: shareViewAuthVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const shareViewAuth = (params: { shareId: string; password: string }) => {
  const { shareId, password } = params;
  return axios.post<ShareViewAuthVo>(urlBuilder(SHARE_VIEW_AUTH, { shareId }), { password });
};
