import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const INCREMENT_TEMPLATE_VISIT = '/template/{templateId}/visit';

export const IncrementTemplateVisitRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: INCREMENT_TEMPLATE_VISIT,
  description: 'Increment template visit count',
  summary: 'Increment template visit count',
  request: {
    params: z.object({
      templateId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully incremented template visit count.',
    },
  },
  tags: ['template'],
});

export const incrementTemplateVisit = async (templateId: string) => {
  return axios.patch<void>(urlBuilder(INCREMENT_TEMPLATE_VISIT, { templateId }));
};
