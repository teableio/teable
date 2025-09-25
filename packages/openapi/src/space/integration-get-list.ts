import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import {
  aiConfigSchema,
  appConfigSchema,
  simpleLLMProviderSchema,
  webSearchConfigSchema,
} from '../admin';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export enum IntegrationType {
  AI = 'AI',
}

export const GET_INTEGRATION_LIST = '/space/{spaceId}/integration';

export const aiIntegrationConfigSchema = aiConfigSchema.extend({
  appConfig: appConfigSchema.optional(),
  webSearchConfig: webSearchConfigSchema.optional(),
});

export type IAIIntegrationConfig = z.infer<typeof aiIntegrationConfigSchema>;

export const integrationConfigSchema = aiIntegrationConfigSchema;

export type IIntegrationConfig = z.infer<typeof integrationConfigSchema>;

export const integrationItemVoSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  type: z.nativeEnum(IntegrationType),
  enable: z.boolean().optional(),
  config: integrationConfigSchema,
  createdTime: z.string(),
  lastModifiedTime: z.string().optional(),
});

export const aiIntegrationSettingSchema = aiConfigSchema
  .pick({
    chatModel: true,
  })
  .extend({
    enable: z.boolean().optional(),
    llmProviders: z.array(
      simpleLLMProviderSchema.omit({
        isInstance: true,
      })
    ),
  });

export type IAIIntegrationAISetting = z.infer<typeof aiIntegrationSettingSchema>;

export type IIntegrationItemVo = z.infer<typeof integrationItemVoSchema>;

export const GetIntegrationListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_INTEGRATION_LIST,
  description: 'Get integration list by query',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the list of integration.',
      content: {
        'application/json': {
          schema: z.array(integrationItemVoSchema),
        },
      },
    },
  },
  tags: ['space', 'integration'],
});

export const getIntegrationList = async (spaceId: string) => {
  return axios.get<IIntegrationItemVo[]>(urlBuilder(GET_INTEGRATION_LIST, { spaceId }));
};
