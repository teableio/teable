import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const NOTIFY_URL = '/attachments/notify/{secret}';

export const notifyVoSchema = z.object({
  token: z.string().openapi({ example: 'xxxxxxxxxxx', description: 'Token for the uploaded file' }),
  size: z.number().openapi({ example: 1024, description: 'File size in bytes' }),
  mimetype: z
    .string()
    .openapi({ example: 'video/mp4', description: 'MIME type of the uploaded file' }),
  path: z.string().openapi({ example: '/attachments', description: 'URL of the uploaded file' }),
  url: z.string().openapi({ description: 'Attachment url' }),
  width: z.number().openapi({ example: 100, description: 'Image width of the uploaded file' }),
  height: z.number().openapi({ example: 100, description: 'Image height of the uploaded file' }),
});

export type INotifyVo = z.infer<typeof notifyVoSchema>;

export const NotifyRoute: RouteConfig = registerRoute({
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
});

export const notify = async (secret: string) => {
  return axios.post<INotifyVo>(urlBuilder(NOTIFY_URL, { secret }));
};
