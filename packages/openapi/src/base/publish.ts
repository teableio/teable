import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { templateCoverRoSchema } from '../template';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PUBLISH_BASE = '/base/{baseId}/publish';

export const publishBaseRoSchema = z.object({
  title: z.string(),
  description: z.string(),
  cover: templateCoverRoSchema.optional().nullable(),
  nodes: z.array(z.string()).optional(),
  includeData: z.boolean().optional(),
  defaultActiveNodeId: z.string().optional().nullable(),
});

export type IPublishBaseRo = z.infer<typeof publishBaseRoSchema>;

export const PublishBaseRoute: RouteConfig = registerRoute({
  method: 'put',
  path: PUBLISH_BASE,
  description: 'publish or unpublish a base',
  summary: 'publish or unpublish a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: publishBaseRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'publish base successfully',
    },
  },
  tags: ['base'],
});

export const publishBase = async (baseId: string, publishBaseRo: IPublishBaseRo) => {
  return await axios.post<{ baseId: string }>(
    urlBuilder(PUBLISH_BASE, {
      baseId,
    }),
    publishBaseRo
  );
};
