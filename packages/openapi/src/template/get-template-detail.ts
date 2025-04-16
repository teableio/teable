import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import type { ITemplateVo } from './get';
import { templateVoSchema } from './get';

export const GET_TEMPLATE_DETAIL = '/template/{templateId}';

export const GetTemplateDetailRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TEMPLATE_DETAIL,
  description: 'get template detail by templateId',
  summary: 'get template detail by templateId',
  request: {},
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

export const getTemplateDetail = async (templateId: string) => {
  return axios.get<ITemplateVo>(urlBuilder(GET_TEMPLATE_DETAIL, { templateId }));
};
