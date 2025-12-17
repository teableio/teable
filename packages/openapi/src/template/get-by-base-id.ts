import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import type { ITemplateVo } from './get';
import { templateVoSchema } from './get';

export const GET_TEMPLATE_BY_BASE_ID = '/template/by-base/{baseId}';

export const GetTemplateByBaseIdRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TEMPLATE_BY_BASE_ID,
  description: 'get template by baseId',
  summary: 'get template by baseId',
  request: {},
  responses: {
    200: {
      description: 'Successfully get template.',
      content: {
        'application/json': {
          schema: templateVoSchema.nullable(),
        },
      },
    },
  },
  tags: ['template'],
});

export const getTemplateByBaseId = async (baseId: string) => {
  return axios.get<ITemplateVo | null>(urlBuilder(GET_TEMPLATE_BY_BASE_ID, { baseId }));
};
