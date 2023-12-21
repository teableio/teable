import { registerRoute } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const READ_FILE_URL = '/attachments/{token}';

export const ReadFileRoute: RouteConfig = registerRoute({
  method: 'get',
  path: READ_FILE_URL,
  description: 'Upload attachment',
  request: {
    params: z.object({
      token: z.string().describe('Token for the uploaded file'),
    }),
    query: z.object({
      filename: z.string().optional().describe('File name for download'),
    }),
  },
  responses: {
    200: {
      description: '',
    },
  },
  schemaProps: {
    token: {
      example: 'xxxxxxxxxxx',
    },
    filename: {
      example: 'file',
    },
  },
  tags: ['attachments'],
});
