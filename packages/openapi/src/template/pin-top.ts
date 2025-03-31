import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PIN_TOP_TEMPLATE = '/template/{templateId}/pin-top';

export const PinTopTemplateRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: PIN_TOP_TEMPLATE,
  description: 'pin top a template',
  request: {
    params: z.object({
      templateId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Successfully pin top a template.',
    },
  },
  tags: ['template'],
});

export const pinTopTemplate = async (templateId: string) => {
  return axios.patch<void>(urlBuilder(PIN_TOP_TEMPLATE, { templateId }));
};
