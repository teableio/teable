import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { notifyVoSchema } from '../attachment';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_TEMPLATE = '/template/{templateId}';

export const templateCoverRoSchema = notifyVoSchema
  .pick({
    token: true,
    size: true,
    url: true,
    path: true,
    mimetype: true,
    width: true,
    height: true,
  })
  .extend({
    name: z.string(),
    id: z.string().startsWith(IdPrefix.Attachment),
  });

export type ITemplateCoverRo = z.infer<typeof templateCoverRoSchema>;

export const updateTemplateRoSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  cover: templateCoverRoSchema.optional().nullable(),
  isPublished: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  baseId: z.string().optional(),
  markdownDescription: z.string().optional(),
});

export type IUpdateTemplateRo = z.infer<typeof updateTemplateRoSchema>;

export const UpdateTemplateRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_TEMPLATE,
  description: 'update a template',
  request: {
    params: z.object({
      templateId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateTemplateRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully update template.',
    },
  },
  tags: ['template'],
});

export const updateTemplate = async (
  templateId: string,
  updateTemplateRoSchema: IUpdateTemplateRo
) => {
  return axios.patch<void>(urlBuilder(UPDATE_TEMPLATE, { templateId }), updateTemplateRoSchema);
};
