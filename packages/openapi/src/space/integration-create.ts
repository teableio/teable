import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { integrationConfigSchema, IntegrationType } from './integration-get-list';

export const CREATE_INTEGRATION = '/space/{spaceId}/integration';

export const createIntegrationRoSchema = z.object({
  type: z.nativeEnum(IntegrationType),
  enable: z.boolean().optional(),
  config: integrationConfigSchema,
});

export type ICreateIntegrationRo = z.infer<typeof createIntegrationRoSchema>;

export const CreateIntegrationRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_INTEGRATION,
  description: 'Create a integration to a space',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createIntegrationRoSchema,
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

export const createIntegration = async (
  spaceId: string,
  createIntegrationRo: ICreateIntegrationRo
) => {
  return await axios.post(
    urlBuilder(CREATE_INTEGRATION, {
      spaceId,
    }),
    createIntegrationRo
  );
};
