import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_USER_INTEGRATION = '/user-integrations/{integrationId}';

export const deleteUserIntegrationSchema = z.object({
  integrationId: z.string(),
});

export type IDeleteUserIntegrationRo = z.infer<typeof deleteUserIntegrationSchema>;

export const deleteUserIntegrationRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_USER_INTEGRATION,
  description: 'Delete user integration',
  request: {
    params: z.object({
      integrationId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['user-integration'],
});

export const deleteUserIntegration = async (integrationId: string) => {
  return await axios.delete<void>(urlBuilder(DELETE_USER_INTEGRATION, { integrationId }));
};
