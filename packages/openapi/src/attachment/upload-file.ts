import type { ReadStream } from 'fs';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';

import { z } from '../zod';

export const UPLOAD_FILE_URL = '/attachments/upload/{token}';

export const UploadFileRoute: RouteConfig = registerRoute({
  method: 'post',
  path: UPLOAD_FILE_URL,
  description: 'Upload attachment',
  request: {
    params: z.object({
      token: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.string().openapi({ format: 'binary' }),
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

export const uploadFile = async (
  token: string,
  data: Buffer | ReadStream,
  header: Record<string, unknown>,
  shareId?: string
) => {
  return axios.put(`/attachments/upload/${token}`, data, {
    headers: {
      ...header,
      'Tea-Share-Id': shareId,
    },
  });
};
