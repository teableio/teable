import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const READ_FILE_URL = '/attachments/{token}';

export const ReadFileRoute: RouteConfig = registerRoute({
  method: 'get',
  path: READ_FILE_URL,
  description: 'Upload attachment',
  request: {
    params: z.object({
      token: z.string(),
    }),
    query: z.object({
      filename: z.string().optional().openapi({ description: 'File name for download' }),
    }),
  },
  responses: {
    200: {
      description: '',
    },
  },
  tags: ['attachments'],
});
