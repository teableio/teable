import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { SIGNATURE_URL } from '../path';
import { signatureVoSchema } from '../schema';

export const SignatureRoute: RouteConfig = {
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
};
