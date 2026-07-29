import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { shortLinkVoSchema } from './create';
import type { IShortLinkVo } from './create';

export const GET_SHORT_LINK = '/short-link/{code}';

export const GetShortLinkRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SHORT_LINK,
  description: 'Resolve a short link code to its target path',
  summary: 'Resolve a short link',
  request: {
    params: z.object({
      code: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully resolved short link.',
      content: {
        'application/json': {
          schema: shortLinkVoSchema,
        },
      },
    },
  },
  tags: ['short-link'],
});

export const getShortLink = async (code: string) => {
  return axios.get<IShortLinkVo>(urlBuilder(GET_SHORT_LINK, { code }));
};
