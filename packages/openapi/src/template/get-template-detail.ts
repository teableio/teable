import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { ITemplateVo } from './get';
import { templateVoSchema } from './get';

export const GET_TEMPLATE_DETAIL = '/template/{templateId}';

export const getTemplateDetailQuerySchema = z.object({
  featured: z.coerce.boolean().optional(),
  categoryId: z.string().startsWith(IdPrefix.TemplateCategory).optional(),
});

export type IGetTemplateDetailQuery = z.infer<typeof getTemplateDetailQuerySchema>;

export const GetTemplateDetailRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TEMPLATE_DETAIL,
  description: 'get template detail by templateId',
  summary: 'get template detail by templateId',
  request: {
    query: getTemplateDetailQuerySchema,
  },
  responses: {
    201: {
      description: 'Successfully get template detail.',
      content: {
        'application/json': {
          schema: templateVoSchema,
        },
      },
    },
  },
  tags: ['template'],
});

export const getTemplateDetail = async (templateId: string, query?: IGetTemplateDetailQuery) => {
  return axios.get<ITemplateVo>(urlBuilder(GET_TEMPLATE_DETAIL, { templateId }), {
    params: query,
  });
};
