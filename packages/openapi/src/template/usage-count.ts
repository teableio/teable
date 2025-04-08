import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_TEMPLATE_USAGE_COUNT = '/template/{templateId}/usage-count';

export const UpdateTemplateUseCountRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_TEMPLATE_USAGE_COUNT,
  description: 'update a template usage count',
  request: {
    params: z.object({
      templateId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Successfully update template usage count.',
    },
  },
  tags: ['template'],
});

export const updateTemplateUsageCount = async (templateId: string) => {
  return axios.patch<void>(urlBuilder(UPDATE_TEMPLATE_USAGE_COUNT, { templateId }));
};
