import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';

export enum LLMProviderType {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
  AZURE = 'azure',
  COHERE = 'cohere',
  MISTRAL = 'mistral',
  DEEPSEEK = 'deepseek',
  QWEN = 'qwen',
  ZHIPU = 'zhipu',
  LINGYIWANWU = 'lingyiwanwu',
  XAI = 'xai',
  TOGETHERAI = 'togetherai',
  OLLAMA = 'ollama',
  AMAZONBEDROCK = 'amazonBedrock',
  OPENROUTER = 'openRouter',
}

export const llmProviderSchema = z.object({
  type: z.nativeEnum(LLMProviderType),
  name: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  models: z.string().default(''),
  isInstance: z.boolean().optional(),
});

export type LLMProvider = z.infer<typeof llmProviderSchema>;

export const chatModelAbilitySchema = z.object({
  image: z.boolean().optional(),
  pdf: z.boolean().optional(),
  webSearch: z.boolean().optional(),
});

export const chatModelAbilityType = chatModelAbilitySchema.keyof();

export type IChatModelAbilityType = z.infer<typeof chatModelAbilityType>;

export type IChatModelAbility = z.infer<typeof chatModelAbilitySchema>;

export const chatModelSchema = z.object({
  lg: z.string().optional(),
  md: z.string().optional(),
  sm: z.string().optional(),
  ability: chatModelAbilitySchema.optional(),
});

export const aiConfigSchema = z.object({
  llmProviders: z.array(llmProviderSchema).default([]),
  embeddingModel: z.string().optional(),
  translationModel: z.string().optional(),
  chatModel: chatModelSchema.optional(),
  capabilities: z
    .object({
      disableActions: z.array(z.string()).optional(),
    })
    .optional(),
});

export type IAIConfig = z.infer<typeof aiConfigSchema>;

export const aiConfigVoSchema = aiConfigSchema.merge(
  z.object({
    enable: z.boolean().optional(),
  })
);

export const appConfigSchema = z.object({
  apiKey: z.string().optional(),
  creditCount: z.number().min(0).optional(),
});

export type IAppConfig = z.infer<typeof appConfigSchema>;

export const webSearchConfigSchema = z.object({
  apiKey: z.string().optional(),
});

export type IWebSearchConfig = z.infer<typeof webSearchConfigSchema>;

export const updateSettingRoSchema = z.object({
  disallowSignUp: z.boolean().optional(),
  disallowSpaceCreation: z.boolean().optional(),
  disallowSpaceInvitation: z.boolean().optional(),
  enableEmailVerification: z.boolean().optional(),
  aiConfig: aiConfigVoSchema.optional(),
  enableWaitlist: z.boolean().optional(),
  appConfig: appConfigSchema.optional(),
  webSearchConfig: webSearchConfigSchema.optional(),
  brandName: z.string().optional(),
});

export type IUpdateSettingRo = z.infer<typeof updateSettingRoSchema>;

export const UPDATE_SETTING = '/admin/setting';

export const UpdateSettingRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_SETTING,
  description: 'Get the instance settings',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateSettingRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Update settings successfully.',
    },
  },
  tags: ['admin'],
});

export const updateSetting = async (updateSettingRo: IUpdateSettingRo) => {
  return axios.patch(UPDATE_SETTING, updateSettingRo);
};
