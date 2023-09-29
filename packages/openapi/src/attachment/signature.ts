import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const signatureVoSchema = z.object({
  url: z.string().openapi({
    example: 'https://example.com/attachment/upload',
    description: 'Upload url',
  }),
  secret: z.string().openapi({ example: 'xxxxxxxx', description: 'Secret key' }),
});

export type SignatureVo = z.infer<typeof signatureVoSchema>;

export const SIGNATURE_URL = '/attachments/signature';

export const SignatureRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SIGNATURE_URL,
  description: 'I need to retrieve the upload URL and the key.',
  request: {},
  responses: {
    200: {
      description: 'I need to retrieve the upload URL and the key.',
      content: {
        'application/json': {
          schema: signatureVoSchema,
        },
      },
    },
  },
  tags: ['attachments'],
});

export const getSignature = async () => {
  return axios.post<SignatureVo>(SIGNATURE_URL);
};
