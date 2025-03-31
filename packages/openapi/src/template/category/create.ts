import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import type { ITemplateCategoryListVo } from './get';

export const CREATE_TEMPLATE_CATEGORY = '/template/category/create';

export const createTemplateCategoryRoSchema = z.object({
  name: z.string(),
});

export type ICreateTemplateCategoryRo = z.infer<typeof createTemplateCategoryRoSchema>;

export const CreateTemplateCategoryRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_TEMPLATE_CATEGORY,
  description: 'create a template category',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createTemplateCategoryRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully create template category.',
    },
  },
  tags: ['template'],
});

export const createTemplateCategory = async (
  createTemplateCategoryRo: ICreateTemplateCategoryRo
) => {
  return axios.post<ITemplateCategoryListVo>(
    urlBuilder(CREATE_TEMPLATE_CATEGORY),
    createTemplateCategoryRo
  );
};
