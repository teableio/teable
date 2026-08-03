import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { integrationConfigSchema } from './integration-get-list';

export const UPDATE_INTEGRATION = '/space/{spaceId}/integration/{integrationId}';

export const updateIntegrationRoSchema = z.object({
  enable: z.boolean().optional(),
  config: integrationConfigSchema.optional(),
});

export type IUpdateIntegrationRo = z.infer<typeof updateIntegrationRoSchema>;

export const UpdateIntegrationRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_INTEGRATION,
  description: 'Update a integration to a space',
  request: {
    params: z.object({
      spaceId: z.string(),
      integrationId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateIntegrationRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successful response.',
    },
  },
  tags: ['space', 'integration'],
});

export const updateIntegration = async (
  spaceId: string,
  integrationId: string,
  updateIntegrationRo: IUpdateIntegrationRo
) => {
  return await axios.patch(
    urlBuilder(UPDATE_INTEGRATION, {
      spaceId,
      integrationId,
    }),
    updateIntegrationRo
  );
};
