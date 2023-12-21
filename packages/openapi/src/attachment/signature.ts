import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const signatureVoSchema = z.object({
  url: z.string().describe('Upload url').openapi({
    example: 'https://example.com/attachment/upload',
  }),
  secret: z.string().describe('Secret key').openapi({ example: 'xxxxxxxx' }),
});

export type SignatureVo = z.infer<typeof signatureVoSchema>;

export const SIGNATURE_URL = '/attachments/signature';

export const SignatureRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SIGNATURE_URL,
  description: 'Retrieve upload signature.',
  request: {},
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

export const getSignature = async () => {
  return axios.post<SignatureVo>(SIGNATURE_URL);
};
