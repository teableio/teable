import { z } from '../zod';

export const uploadFileRoSchema = z.object({
  file: z.string().openapi({ format: 'binary' }),
});

export type UploadFileRo = z.infer<typeof uploadFileRoSchema>;

export const signatureVoSchema = z.object({
  url: z.string().openapi({
    example: 'https://example.com/attachment/upload',
    description: 'Upload url',
  }),
  secret: z.string().openapi({ example: 'xxxxxxxx', description: 'Secret key' }),
});

export type SignatureVo = z.infer<typeof signatureVoSchema>;

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

export type NotifyVo = z.infer<typeof notifyVoSchema>;
