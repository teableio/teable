import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { createBaseVoSchema } from './create';

export const CREATE_BASE_FROM_TEMPLATE = '/base/create-from-template';

export const createBaseFromTemplateRoSchema = z.object({
  spaceId: z.string().describe('The space id to create a base from'),
  templateId: z.string().describe('The template id to create a base from'),
  withRecords: z.boolean().optional().describe('Whether to create records from the template'),
  baseId: z.string().optional().describe('The base id to apply the template to'),
});

export type ICreateBaseFromTemplateRo = z.infer<typeof createBaseFromTemplateRoSchema>;

export const createBaseFromTemplateVoSchema = createBaseVoSchema.extend({
  defaultUrl: z.string().optional(),
});

export type ICreateBaseFromTemplateVo = z.infer<typeof createBaseFromTemplateVoSchema>;

export const CreateBaseFromTemplateRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_BASE_FROM_TEMPLATE,
  summary: 'Create a base from template or apply a template to a base',
  description: 'Create a base from template or apply a template to a base',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createBaseFromTemplateRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns information about a successfully created base.',
      content: {
        'application/json': {
          schema: createBaseFromTemplateVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const createBaseFromTemplate = async (createBaseRo: ICreateBaseFromTemplateRo) => {
  return axios.post<ICreateBaseFromTemplateVo>(CREATE_BASE_FROM_TEMPLATE, createBaseRo);
};
