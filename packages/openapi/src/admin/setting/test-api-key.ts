import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { attachmentModeTestResultSchema, attachmentTransferModeSchema } from './update';

export const testApiKeyRoSchema = z.object({
  type: z.enum(['aiGateway', 'v0']),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  // Whether to also test attachment transfer modes (URL and Base64)
  testAttachment: z.boolean().optional(),
});

export type ITestApiKeyRo = z.infer<typeof testApiKeyRoSchema>;

// Attachment test result schema
export const attachmentTestResultSchema = z.object({
  // URL mode test result
  urlMode: attachmentModeTestResultSchema.optional(),
  // Base64 mode test result
  base64Mode: attachmentModeTestResultSchema.optional(),
  // Recommended mode based on test results
  recommendedMode: attachmentTransferModeSchema.optional(),
  // PUBLIC_ORIGIN used during test
  testedOrigin: z.string().optional(),
});

export type IAttachmentTestResult = z.infer<typeof attachmentTestResultSchema>;

export const testApiKeyVoSchema = z.object({
  success: z.boolean(),
  error: z
    .object({
      code: z.enum([
        'unauthorized',
        'forbidden',
        'need_credit_card',
        'insufficient_quota',
        'network_error',
        'unknown',
      ]),
      message: z.string().optional(),
    })
    .optional(),
  // Attachment test results (only present if testAttachment was true)
  attachmentTest: attachmentTestResultSchema.optional(),
});

export type ITestApiKeyVo = z.infer<typeof testApiKeyVoSchema>;

export const TEST_API_KEY = '/admin/setting/test-api-key';

export const TestApiKeyRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TEST_API_KEY,
  description:
    'Test API key validity for AI Gateway or v0, optionally test attachment transfer modes',
  request: {
    body: {
      content: {
        'application/json': {
          schema: testApiKeyRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Test result',
      content: {
        'application/json': {
          schema: testApiKeyVoSchema,
        },
      },
    },
  },
  tags: ['admin', 'setting'],
});

export const testApiKey = async (data: ITestApiKeyRo): Promise<ITestApiKeyVo> => {
  const response = await axios.post<ITestApiKeyVo>(TEST_API_KEY, data);
  return response.data;
};
