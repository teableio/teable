import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_USER_INTEGRATION_NAME = '/user-integrations/{integrationId}/name';

export const updateUserIntegrationNameSchema = z.object({
  name: z.string(),
});

export type IUpdateUserIntegrationNameRo = z.infer<typeof updateUserIntegrationNameSchema>;

export const updateUserIntegrationNameRoute: RouteConfig = registerRoute({
  method: 'put',
  path: UPDATE_USER_INTEGRATION_NAME,
  description: 'Update user integration name',
  request: {
    params: z.object({
      integrationId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateUserIntegrationNameSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated successfully',
    },
  },
  tags: ['user-integration'],
});

export const updateUserIntegrationName = async (integrationId: string, name: string) => {
  return await axios.put<void>(urlBuilder(UPDATE_USER_INTEGRATION_NAME, { integrationId }), {
    name,
  });
};
