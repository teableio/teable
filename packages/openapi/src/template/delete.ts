import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_TEMPLATE = '/template/{templateId}';

export const DeleteTemplateRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_TEMPLATE,
  description: 'delete a template',
  request: {
    params: z.object({
      templateId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Successfully delete template.',
    },
  },
  tags: ['template'],
});

export const deleteTemplate = async (templateId: string) => {
  return axios.delete<void>(urlBuilder(DELETE_TEMPLATE, { templateId }));
};
