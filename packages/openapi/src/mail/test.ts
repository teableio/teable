import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { mailTransportConfigSchema } from './types';

export const testMailTransportConfigRoSchema = z.object({
  to: z.string().email(),
  message: z.string().optional(),
  transportConfig: mailTransportConfigSchema,
});

export type ITestMailTransportConfigRo = z.infer<typeof testMailTransportConfigRoSchema>;

export const TEST_MAIL_TRANSPORT_CONFIG = '/mail-sender/test-transport-config';

export const TestMailTransportConfigRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TEST_MAIL_TRANSPORT_CONFIG,
  description: 'Test mail transporter',
  request: {
    body: {
      content: {
        'application/json': {
          schema: testMailTransportConfigRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Test mail transporter successfully.',
    },
  },
  tags: ['mail'],
});

export const testMailTransportConfig = async (ro: ITestMailTransportConfigRo) => {
  return await axios.post<void>(TEST_MAIL_TRANSPORT_CONFIG, ro);
};
