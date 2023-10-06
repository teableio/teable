import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const UPLOAD_FILE_URL = '/attachments/upload/{token}';

export const uploadFileRoSchema = z.object({
  file: z.string().openapi({ format: 'binary' }),
});

export type UploadFileRo = z.infer<typeof uploadFileRoSchema>;

export const UploadFileRoute: RouteConfig = registerRoute({
  method: 'post',
  path: UPLOAD_FILE_URL,
  description: 'Upload attachment',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: uploadFileRoSchema,
        },
      },
      description: 'upload attachment',
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Upload successful',
    },
  },
  tags: ['attachments'],
});
