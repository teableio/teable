import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { z } from 'zod';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';

export const GET_TEMPLATE_CATEGORY_LIST = '/template/category/list';

export const templateCategoryListVoSchema = z.object({
  id: z.string().startsWith(IdPrefix.TemplateCategory),
  name: z.string(),
  order: z.number(),
});

export type ITemplateCategoryListVo = z.infer<typeof templateCategoryListVoSchema>;

export const GetTemplateCategoryListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TEMPLATE_CATEGORY_LIST,
  description: 'get template category list',
  request: {},
  responses: {
    200: {
      description: 'Successfully get template category list.',
    },
  },
  tags: ['template'],
});

export const getTemplateCategoryList = async () => {
  return axios.get<ITemplateCategoryListVo[]>(urlBuilder(GET_TEMPLATE_CATEGORY_LIST));
};
