import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { UPLOAD_FILE_URL } from '../path';
import { uploadFileRoSchema } from '../schema';

export const UploadFileRoute: RouteConfig = {
  method: 'post',
  path: UPLOAD_FILE_URL,
  description: 'upload attachment',
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
};
