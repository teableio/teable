import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const CREATE_SNAPSHOT = '/template/{templateId}/snapshot';

export const CreateTemplateSnapshotRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_SNAPSHOT,
  description: 'create a template snapshot',
  request: {
    params: z.object({
      templateId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Successfully create template snapshot.',
    },
  },
  tags: ['template'],
});

export const createTemplateSnapshot = async (templateId: string) => {
  return axios.post<void>(urlBuilder(CREATE_SNAPSHOT, { templateId }));
};
