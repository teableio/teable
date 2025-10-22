import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const EXPORT_UNSUBSCRIBE_LIST = '/unsubscribe/export-list/{baseId}';

export const exportUnsubscribeListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: EXPORT_UNSUBSCRIBE_LIST,
  description: 'Export unsubscribe list',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Export unsubscribe list successfully',
    },
  },
  tags: ['unsubscribe'],
});

export const exportUnsubscribeList = async (baseId: string) => {
  return axios.get(urlBuilder(EXPORT_UNSUBSCRIBE_LIST, { baseId }));
};
