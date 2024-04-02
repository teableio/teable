import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { ICreateBaseVo } from './create';
import { createBaseVoSchema } from './create';

export const CREATE_BASE_FROM_TEMPLATE = '/base/create-from-template';

export const createBaseFromTemplateRoSchema = z.object({
  spaceId: z.string(),
  templateId: z.string(),
  withRecords: z.boolean().optional(),
});

export type ICreateBaseFromTemplateRo = z.infer<typeof createBaseFromTemplateRoSchema>;

export const CreateBaseFromTemplateRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_BASE_FROM_TEMPLATE,
  description: 'Create a base from template',
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
          schema: createBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const createBaseFromTemplate = async (createBaseRo: ICreateBaseFromTemplateRo) => {
  return axios.post<ICreateBaseVo>(CREATE_BASE_FROM_TEMPLATE, createBaseRo);
};
