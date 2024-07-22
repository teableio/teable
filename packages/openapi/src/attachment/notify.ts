import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const NOTIFY_URL = '/attachments/notify/{token}';

export const notifyVoSchema = z.object({
  token: z.string().openapi({ example: 'xxxxxxxxxxx', description: 'Token for the uploaded file' }),
  size: z.number().openapi({ example: 1024, description: 'File size in bytes' }),
  url: z.string().openapi({ example: '/bucket/xxxxx', description: 'URL of the uploaded file' }),
  path: z.string().openapi({ example: '/table/xxxxxx', description: 'file path' }),
  mimetype: z
    .string()
    .openapi({ example: 'video/mp4', description: 'MIME type of the uploaded file' }),
  width: z
    .number()
    .optional()
    .openapi({ example: 100, description: 'Image width of the uploaded file' }),
  height: z
    .number()
    .optional()
    .openapi({ example: 100, description: 'Image height of the uploaded file' }),
  presignedUrl: z.string().openapi({ description: 'Preview url' }),
});

export type INotifyVo = z.infer<typeof notifyVoSchema>;

export const NotifyRoute: RouteConfig = registerRoute({
  method: 'post',
  path: NOTIFY_URL,
  description: 'Get Attachment information',
  request: {
    params: z.object({
      token: z.string(),
    }),
    query: z.object({
      filename: z.string().optional(),
    }),
  },
  responses: {
    201: {
      description: 'Attachment information',
      content: {
        'application/json': {
          schema: notifyVoSchema,
        },
      },
    },
  },
  tags: ['attachments'],
});

export const notify = async (token: string, shareId?: string, filename?: string) => {
  return axios.post<INotifyVo>(urlBuilder(NOTIFY_URL, { token }), undefined, {
    headers: {
      'Tea-Share-Id': shareId,
    },
    params: { filename },
  });
};
