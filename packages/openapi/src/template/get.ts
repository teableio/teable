import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { templateCoverRoSchema } from './update';

export const GET_TEMPLATE_LIST = '/template';

export const templateCoverVoSchema = templateCoverRoSchema.extend({
  presignedUrl: z.string(),
});

export type ITemplateCoverVo = z.infer<typeof templateCoverVoSchema>;

export const templateVoSchema = z.object({
  id: z.string().startsWith(IdPrefix.Template),
  name: z.string().optional(),
  categoryId: z.string().startsWith(IdPrefix.TemplateCategory).optional(),
  isSystem: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  snapshot: z.object({
    baseId: z.string().startsWith(IdPrefix.Base),
    snapshotTime: z.string().datetime(),
    spaceId: z.string().startsWith(IdPrefix.Space),
    name: z.string(),
  }),
  description: z.string().optional(),
  baseId: z.string().startsWith(IdPrefix.Base).optional(),
  cover: templateCoverVoSchema,
  usageCount: z.number(),
  markdownDescription: z.string().optional(),
});

export type ITemplateVo = z.infer<typeof templateVoSchema>;

export const GetTemplateRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TEMPLATE_LIST,
  description: 'get template list',
  request: {},
  responses: {
    201: {
      description: 'Successfully get template list.',
      content: {
        'application/json': {
          schema: z.array(templateVoSchema),
        },
      },
    },
  },
  tags: ['template'],
});

export const getTemplateList = async () => {
  return axios.get<ITemplateVo[]>(urlBuilder(GET_TEMPLATE_LIST));
};
