import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const NOTIFY_URL = '/attachments/notify/{secret}';

export const notifyVoSchema = z.object({
  token: z.string().describe('Token for the uploaded file').openapi({ example: 'xxxxxxxxxxx' }),
  size: z.number().describe('File size in bytes').openapi({ example: 1024 }),
  mimetype: z.string().describe('MIME type of the uploaded file').openapi({ example: 'video/mp4' }),
  path: z.string().describe('URL of the uploaded file').openapi({ example: '/attachments' }),
  url: z.string().describe('Attachment url'),
  width: z.number().describe('Image width of the uploaded file').openapi({ example: 100 }),
  height: z.number().describe('Image height of the uploaded file').openapi({ example: 100 }),
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

export const notify = async (secret: string) => {
  return axios.post<INotifyVo>(urlBuilder(NOTIFY_URL, { secret }));
};
