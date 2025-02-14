import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IAIConfig } from '../admin';
import { aiConfigSchema } from '../admin';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

export const GET_AI_CONFIG = '/{baseId}/ai/config';

export const GetAIConfigRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_AI_CONFIG,
  description: 'Get the instance settings',
  request: {},
  responses: {
    200: {
      description: 'Returns the instance settings.',
      content: {
        'application/json': {
          schema: aiConfigSchema,
        },
      },
    },
  },
  tags: ['admin'],
});

export const getAIConfig = async (baseId: string) => {
  return axios.get<IAIConfig>(urlBuilder(GET_AI_CONFIG, { baseId }));
};
