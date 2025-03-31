import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import type { ITemplateVo } from './get';

export const GET_PUBLISHED_TEMPLATE_LIST = '/template/published';

export const GetPublishedTemplateListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PUBLISHED_TEMPLATE_LIST,
  description: 'get published template list',
  request: {},
  responses: {
    201: {
      description: 'Successfully get published template list.',
    },
  },
  tags: ['template'],
});

export const getPublishedTemplateList = async () => {
  return axios.get<ITemplateVo[]>(urlBuilder(GET_PUBLISHED_TEMPLATE_LIST));
};
