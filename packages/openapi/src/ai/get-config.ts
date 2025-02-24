import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { aiConfigSchema } from '../admin';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

export const GET_AI_CONFIG = '/{baseId}/ai/config';

export const modelRateSchema = z.object({
  inputRate: z.number().openapi({
    example: 0.001,
    description: 'The number of credits spent using a prompt token',
  }),
  outputRate: z.number().openapi({
    example: 0.0025,
    description: 'The number of credits spent using a completion token',
  }),
});

export type IModelRate = z.infer<typeof modelRateSchema>;

export const modelRateMapSchema = z.record(z.string(), modelRateSchema);

export type IModelRateMap = z.infer<typeof modelRateMapSchema>;

export const getAIConfigSchema = aiConfigSchema.merge(
  z.object({
    modelRateMap: modelRateMapSchema.optional(),
  })
);

export type IGetAIConfig = z.infer<typeof getAIConfigSchema>;

export const GetAIConfigRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_AI_CONFIG,
  description: 'Get the configuration of ai, including instance and space configuration',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the configuration of ai.',
      content: {
        'application/json': {
          schema: getAIConfigSchema,
        },
      },
    },
  },
  tags: ['ai'],
});

export const getAIConfig = async (baseId: string) => {
  return axios.get<IGetAIConfig>(urlBuilder(GET_AI_CONFIG, { baseId }));
};
