import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { ITemplateVo } from './get';

export const CREATE_TEMPLATE = '/template/create';

export const createTemplateRoSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
});

export type ICreateTemplateRo = z.infer<typeof createTemplateRoSchema>;

export const CreateTemplateRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_TEMPLATE,
  description: 'create a template',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createTemplateRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully create template.',
    },
  },
  tags: ['template'],
});

export const createTemplate = async (createTemplateRo: ICreateTemplateRo) => {
  return axios.post<ITemplateVo>(urlBuilder(CREATE_TEMPLATE), createTemplateRo);
};
