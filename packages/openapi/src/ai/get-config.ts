import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { aiConfigSchema } from '../admin';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

export const GET_AI_CONFIG = '/{baseId}/ai/config';

export enum ModelOutputType {
  Image = 'image',
  Audio = 'audio',
  Video = 'video',
}

export const textModelDefinationSchema = z.object({
  inputRate: z.number().openapi({
    example: 0.001,
    description: 'The number of credits spent using a prompt token',
  }),
  outputRate: z.number().openapi({
    example: 0.0025,
    description: 'The number of credits spent using a completion token',
  }),
  visionEnable: z.boolean().optional().openapi({ description: 'Whether to enable vision' }),
  audioEnable: z.boolean().optional().openapi({ description: 'Whether to enable audio' }),
  videoEnable: z.boolean().optional().openapi({ description: 'Whether to enable video' }),
  deepThinkEnable: z.boolean().optional().openapi({ description: 'Whether to enable deep think' }),
});

export type ITextModelDefination = z.infer<typeof textModelDefinationSchema>;

export const imageModelDefinationSchema = z.object({
  usagePerUnit: z.number().openapi({
    example: 100,
    description: 'The number of credits spent for generating one image',
  }),
  outputType: z.nativeEnum(ModelOutputType),
});

export type IImageModelDefination = z.infer<typeof imageModelDefinationSchema>;

export const modelDefinationSchema = z.union([
  textModelDefinationSchema,
  imageModelDefinationSchema,
]);

export const modelDefinationMapSchema = z.record(z.string(), modelDefinationSchema);

export type IModelDefinationMap = z.infer<typeof modelDefinationMapSchema>;

export const getAIConfigSchema = aiConfigSchema.merge(
  z.object({
    modelDefinationMap: modelDefinationMapSchema.optional(),
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
