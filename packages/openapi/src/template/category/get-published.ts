import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import type { ITemplateCategoryListVo } from './get';

export const GET_PUBLISHED_TEMPLATE_CATEGORY_LIST = '/template/category/list/published';

export const GetPublishedTemplateCategoryListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PUBLISHED_TEMPLATE_CATEGORY_LIST,
  description: 'get published template category list',
  summary: 'get published template category list',
  request: {},
  responses: {
    200: {
      description: 'Successfully get template category list.',
    },
  },
  tags: ['template'],
});

export const getPublishedTemplateCategoryList = async () => {
  return axios.get<ITemplateCategoryListVo[]>(urlBuilder(GET_PUBLISHED_TEMPLATE_CATEGORY_LIST));
};
