import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IAIIntegrationAISetting } from './integration-get-list';
import { aiIntegrationSettingSchema } from './integration-get-list';

export const GET_PUBLIC_AI_SETTING = '/space/{spaceId}/public/ai-setting';

export const GetPublicAISettingRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PUBLIC_AI_SETTING,
  description: 'Get public ai setting',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the public ai setting.',
      content: {
        'application/json': {
          schema: aiIntegrationSettingSchema,
        },
      },
    },
  },
  tags: ['space', 'integration'],
});

export const getPublicAISetting = async (spaceId: string) => {
  return axios.get<IAIIntegrationAISetting>(urlBuilder(GET_PUBLIC_AI_SETTING, { spaceId }));
};
