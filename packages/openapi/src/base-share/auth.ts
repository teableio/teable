import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { sharePasswordSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const BASE_SHARE_AUTH = '/share/{shareId}/base/auth';

export const baseShareAuthVoSchema = z.object({
  token: z.string(),
});

export type IBaseShareAuthVo = z.infer<typeof baseShareAuthVoSchema>;

export const BaseShareAuthRoute: RouteConfig = registerRoute({
  method: 'post',
  path: BASE_SHARE_AUTH,
  description: 'Authenticate with password to access shared base',
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
          schema: baseShareAuthVoSchema,
        },
      },
    },
  },
  tags: ['base-share'],
});

export const baseShareAuth = (shareId: string, password: string) => {
  return axios.post<IBaseShareAuthVo>(urlBuilder(BASE_SHARE_AUTH, { shareId }), { password });
};
