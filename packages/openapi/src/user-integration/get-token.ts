import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const POST_USER_INTEGRATION_TOKEN = '/user-integrations/{integrationId}/token';

export const getUserIntegrationTokenVoSchema = z.object({
  accessToken: z.string(),
});

export type IUserIntegrationTokenVo = z.infer<typeof getUserIntegrationTokenVoSchema>;

export const getUserIntegrationTokenRoute: RouteConfig = registerRoute({
  method: 'post',
  path: POST_USER_INTEGRATION_TOKEN,
  description: 'Get a valid access token for a user integration (auto-refreshes if expired)',
  request: {
    params: z.object({
      integrationId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the access token',
      content: {
        'application/json': {
          schema: getUserIntegrationTokenVoSchema,
        },
      },
    },
  },
  tags: ['user-integration'],
});

export const getUserIntegrationToken = async (integrationId: string) => {
  return await axios.post<IUserIntegrationTokenVo>(
    urlBuilder(POST_USER_INTEGRATION_TOKEN, { integrationId })
  );
};
