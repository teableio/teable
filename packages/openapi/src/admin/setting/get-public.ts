import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { settingVoSchema } from './get';
import { llmProviderSchema } from './update';

export const simpleLLMProviderSchema = llmProviderSchema.pick({
  type: true,
  name: true,
  models: true,
  isInstance: true,
});

export type ISimpleLLMProvider = z.infer<typeof simpleLLMProviderSchema>;

const publicAiConfigSchema = z.object({
  enable: z.boolean(),
  llmProviders: z.array(simpleLLMProviderSchema),
  codingModels: z
    .object({
      sm: z.string().optional(),
      md: z.string().optional(),
      lg: z.string().optional(),
    })
    .optional(),
});

export const publicSettingVoSchema = settingVoSchema
  .pick({
    instanceId: true,
    brandName: true,
    brandLogo: true,
    disallowSignUp: true,
    disallowSpaceCreation: true,
    disallowSpaceInvitation: true,
    enableEmailVerification: true,
  })
  .merge(
    z.object({
      aiConfig: publicAiConfigSchema.nullable(),
    })
  );
export type IPublicSettingVo = z.infer<typeof publicSettingVoSchema>;

export const GET_PUBLIC_SETTING = '/admin/setting/public';
export const GetPublicSettingRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PUBLIC_SETTING,
  description: 'Get the public instance settings',
  request: {},
  responses: {
    200: {
      description: 'Returns the public instance settings.',
      content: {
        'application/json': {
          schema: publicSettingVoSchema,
        },
      },
    },
  },
  tags: ['admin'],
});

export const getPublicSetting = async () => {
  return axios.get<IPublicSettingVo>(GET_PUBLIC_SETTING);
};
