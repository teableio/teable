import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { userIntegrationMetadataSchema, UserIntegrationProvider } from './types';

export const GET_USER_INTEGRATION_LIST = '/user-integrations';

export const getUserIntegrationListRoSchema = z.object({
  provider: z.enum(UserIntegrationProvider).optional().describe('Filter by provider'),
});

export type IUserIntegrationListRo = z.infer<typeof getUserIntegrationListRoSchema>;

export const getUserIntegrationItemVoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  provider: z.enum(UserIntegrationProvider),
  name: z.string(),
  lastUsedTime: z.string().optional(),
  createdTime: z.string(),
  connectedTime: z.string().optional(),
  lastModifiedTime: z.string().optional(),
  hasSecret: z.boolean(),
  metadata: userIntegrationMetadataSchema,
});

export type IUserIntegrationItemVo = z.infer<typeof getUserIntegrationItemVoSchema>;

export const getUserIntegrationListSchema = z.object({
  integrations: z.array(getUserIntegrationItemVoSchema),
});

export type IUserIntegrationListVo = z.infer<typeof getUserIntegrationListSchema>;

export const getUserIntegrationListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_USER_INTEGRATION_LIST,
  description: 'Get user integration list',
  request: {
    query: getUserIntegrationListRoSchema,
  },
  responses: {
    200: {
      description: 'Returns the list of user integration.',
      content: {
        'application/json': {
          schema: getUserIntegrationListSchema,
        },
      },
    },
  },
  tags: ['user-integration'],
});

export const getUserIntegrationList = async (query?: IUserIntegrationListRo) => {
  return await axios.get<IUserIntegrationListVo>(GET_USER_INTEGRATION_LIST, { params: query });
};
