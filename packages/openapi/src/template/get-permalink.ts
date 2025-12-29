import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_TEMPLATE_PERMALINK = '/template/permalink/{identifier}';

export const templatePermalinkVoSchema = z.object({
  redirectUrl: z.string(),
});

export type ITemplatePermalinkVo = z.infer<typeof templatePermalinkVoSchema>;

export const GetTemplatePermalinkRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TEMPLATE_PERMALINK,
  description: 'Get template redirect URL for permalink',
  summary: 'Get template permalink redirect URL',
  request: {
    params: z.object({
      identifier: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully resolved template permalink.',
      content: {
        'application/json': {
          schema: templatePermalinkVoSchema,
        },
      },
    },
  },
  tags: ['template'],
});

export const getTemplatePermalink = async (identifier: string) => {
  return axios.get<ITemplatePermalinkVo>(urlBuilder(GET_TEMPLATE_PERMALINK, { identifier }));
};
