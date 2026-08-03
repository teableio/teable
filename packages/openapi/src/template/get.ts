import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { templateCoverRoSchema } from './update';

export const GET_TEMPLATE_LIST = '/template';

export const templateListQueryRoSchema = z.object({
  skip: z.coerce.number().optional().meta({
    default: 0,
    example: 0,
    description: 'The templates count you want to skip',
  }),
  take: z.coerce.number().optional().meta({
    default: 300,
    example: 300,
    description: 'The templates count you want to take',
  }),
});

export type ITemplateListQueryRo = z.infer<typeof templateListQueryRoSchema>;

export const templateCoverVoSchema = templateCoverRoSchema.extend({
  presignedUrl: z.string(),
});

export type ITemplateCoverVo = z.infer<typeof templateCoverVoSchema>;

export const templateVoSchema = z.object({
  id: z.string().startsWith(IdPrefix.Template),
  name: z.string().optional(),
  categoryId: z.array(z.string().startsWith(IdPrefix.TemplateCategory)).optional(),
  isSystem: z.boolean().optional(),
  featured: z.boolean().optional(),
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
  publishInfo: z
    .object({
      nodes: z.array(z.string()).optional(),
      includeData: z.boolean().optional(),
      defaultActiveNodeId: z.string().optional().nullable(),
      defaultUrl: z.string().optional(), // URL for the default active node
    })
    .optional(),
  visitCount: z.number(),
  createdBy: z
    .object({
      id: z.string().startsWith(IdPrefix.User),
      name: z.string().optional(),
      avatar: z.string().optional(),
      email: z.string().optional(),
    })
    .nullable(),
});

export type ITemplateVo = z.infer<typeof templateVoSchema>;

export const GetTemplateRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TEMPLATE_LIST,
  description: 'get template list',
  request: {
    query: templateListQueryRoSchema,
  },
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

export const getTemplateList = async (query?: ITemplateListQueryRo) => {
  return axios.get<ITemplateVo[]>(urlBuilder(GET_TEMPLATE_LIST), {
    params: query,
  });
};
