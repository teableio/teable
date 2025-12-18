import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UNPUBLISH_TEMPLATE = '/template/unpublish/{templateId}';

export const UnpublishTemplateRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: UNPUBLISH_TEMPLATE,
  description: 'unpublish a template',
  request: {
    params: z.object({
      templateId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Successfully unpublish template.',
    },
  },
  tags: ['template'],
});

export const unpublishTemplate = async (templateId: string) => {
  return axios.delete<void>(urlBuilder(UNPUBLISH_TEMPLATE, { templateId }));
};
