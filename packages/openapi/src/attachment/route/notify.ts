import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { NOTIFY_URL } from '../path';
import { notifyVoSchema } from '../schema.def';

export const NotifyRoute: RouteConfig = {
  method: 'post',
  path: NOTIFY_URL,
  description: 'Attachment information',
  request: {
    params: z.object({
      secret: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Attachment information',
      content: {
        'application/json': {
          schema: notifyVoSchema,
        },
      },
    },
  },
  tags: ['attachments'],
};
