import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const UPLOAD_FILE_URL = '/attachments/upload/{token}';

export const UploadFileRoute: RouteConfig = registerRoute({
  method: 'post',
  path: UPLOAD_FILE_URL,
  description: 'Upload attachment',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.string().openapi({ format: 'byte' }),
        },
      },
      description: 'upload attachment',
      required: true,
    },
  },
  responses: {
    201: {
      description: 'Upload successful',
    },
  },
  tags: ['attachments'],
});
