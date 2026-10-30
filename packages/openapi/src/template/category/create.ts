import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import { urlKeySchema } from '../url-key';
import { templateCategoryKindSchema, type ITemplateCategoryListVo } from './get';

export const CREATE_TEMPLATE_CATEGORY = '/template/category/create';

export const MAX_TEMPLATE_CATEGORY_COUNT = 200;

export const createTemplateCategoryRoSchema = z.object({
  name: z.string(),
  /** An industry's id makes this a sub-industry of it; one level only. Teams have no parent. */
  parentId: z.string().optional(),
  /** Omitted: an industry. */
  kind: templateCategoryKindSchema.optional(),
  /** Omitted: derived from the name when that gives a free key. */
  key: urlKeySchema.optional(),
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
