import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export enum UploadType {
  Table = 1,
  Avatar = 2,
  Form = 3,
  OAuth = 4,
  Import = 5,
  Plugin = 6,
  Comment = 7,
  Logo = 8,
  ExportBase = 9,
  Template = 10,
  ChatDataVisualizationCode = 11,
  App = 12,
  ChatFile = 13,
  Automation = 14,
}

export const signatureRoSchema = z.object({
  contentType: z.string().openapi({ example: 'image/png', description: 'Mime type' }),
  contentLength: z.number().openapi({ example: 123, description: 'File size' }),
  expiresIn: z
    .number()
    .optional()
    .openapi({ example: 60 * 60 * 1, description: 'Token expire time, seconds' }),
  hash: z.string().optional().openapi({ example: 'xxxxxxxx', description: 'File hash' }),
  type: z.nativeEnum(UploadType).openapi({ example: UploadType.Table, description: 'Type' }),
  baseId: z.string().optional(),
});

export type SignatureRo = z.infer<typeof signatureRoSchema>;

export const signatureVoSchema = z.object({
  url: z.string().openapi({
    example: 'https://example.com/attachment/upload',
    description: 'Upload url',
  }),
  uploadMethod: z.string().openapi({ example: 'POST', description: 'Upload method' }),
  token: z.string().openapi({ example: 'xxxxxxxx', description: 'Secret key' }),
  requestHeaders: z.record(z.unknown()).openapi({ example: { 'Content-Type': 'image/png' } }),
});

export type SignatureVo = z.infer<typeof signatureVoSchema>;

export const SIGNATURE_URL = '/attachments/signature';

export const SignatureRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SIGNATURE_URL,
  description: 'Retrieve upload signature.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: signatureRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'return the upload URL and the key.',
      content: {
        'application/json': {
          schema: signatureVoSchema,
        },
      },
    },
  },
  tags: ['attachments'],
});

export const getSignature = async (params: SignatureRo, shareId?: string) => {
  return axios.post<SignatureVo>(SIGNATURE_URL, params, {
    headers: {
      'Tea-Share-Id': shareId,
    },
  });
};
