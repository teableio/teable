import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';

export const testPublicAccessVoSchema = z.object({
  success: z.boolean(),
  publicOrigin: z.string().optional(),
  error: z.string().optional(),
  storageCheck: z
    .object({
      success: z.boolean(),
      storageUrl: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
});

export type ITestPublicAccessVo = z.infer<typeof testPublicAccessVoSchema>;

export const TEST_PUBLIC_ACCESS = '/admin/setting/test-public-access';

export const TestPublicAccessRoute: RouteConfig = registerRoute({
  method: 'get',
  path: TEST_PUBLIC_ACCESS,
  description: 'Test if this Teable instance is publicly accessible from the internet',
  responses: {
    200: {
      description: 'Public access test result',
      content: {
        'application/json': {
          schema: testPublicAccessVoSchema,
        },
      },
    },
  },
  tags: ['admin', 'setting'],
});

export const testPublicAccess = async (): Promise<ITestPublicAccessVo> => {
  const response = await axios.get<ITestPublicAccessVo>(TEST_PUBLIC_ACCESS);
  return response.data;
};
