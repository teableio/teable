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
  OPENAI_COMPATIBLE = 'openaiCompatible',
}

// Detailed ability support with URL and base64 variants
export const abilityDetailSchema = z.object({
  url: z.boolean().optional(),
  base64: z.boolean().optional(),
});

export type IAbilityDetail = z.infer<typeof abilityDetailSchema>;

// Model ability schema for test results
export const modelAbilitySchema = z.object({
  image: z.union([z.boolean(), abilityDetailSchema]).optional(),
  pdf: z.union([z.boolean(), abilityDetailSchema]).optional(),
  webSearch: z.boolean().optional(),
  toolCall: z.boolean().optional(),
});

export type IModelAbility = z.infer<typeof modelAbilitySchema>;

// Image model ability schema
export const imageModelAbilitySchema = z.object({
  generation: z.boolean().optional(), // can generate images from text
  imageToImage: z.boolean().optional(), // can generate images from image input
});

export type IImageModelAbility = z.infer<typeof imageModelAbilitySchema>;

// Model-specific configuration (rates in credits per 1M tokens + test results)
// Rate conversion: credits = tokens * rate / 1M * TOKEN_TO_CREDIT_RATE
export const modelConfigSchema = z.object({
  // Standard rates (credits per 1M tokens)
  inputRate: z.number().min(0).optional(), // Standard input rate
  outputRate: z.number().min(0).optional(), // Standard output rate

  // Detailed rates for cached/reasoning tokens (AI SDK 6 support)
  // If not set, fallback to inputRate/outputRate
  cacheReadRate: z.number().min(0).optional(), // Cached input tokens (usually 10-50% of inputRate, or 0 for free)
  cacheWriteRate: z.number().min(0).optional(), // Cache write tokens (usually same as inputRate or 25% more)
  reasoningRate: z.number().min(0).optional(), // Reasoning tokens like o1 (usually same as outputRate)

  // Image generation rate (credits per image)
  imageRate: z.number().min(0).optional(),

  // Mark as image generation model
  isImageModel: z.boolean().optional(),
  // Persisted test results for text models
  ability: modelAbilitySchema.optional(),
  // Persisted test results for image models
  imageAbility: imageModelAbilitySchema.optional(),
  testedAt: z.number().optional(), // timestamp of last test
});

export type IModelConfig = z.infer<typeof modelConfigSchema>;

export const llmProviderSchema = z.object({
  type: z.enum(LLMProviderType),
  name: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  models: z.string().default(''),
  isInstance: z.boolean().optional(),
  // Model-specific configurations keyed by model name
  modelConfigs: z.record(z.string(), modelConfigSchema).optional(),
});

export type LLMProvider = z.infer<typeof llmProviderSchema>;

// chatModelAbilitySchema is same as modelAbilitySchema, for backward compatibility
export const chatModelAbilitySchema = modelAbilitySchema;

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

export const aiConfigVoSchema = aiConfigSchema.extend({
  enable: z.boolean().optional(),
});

export const appConfigSchema = z.object({
  apiKey: z.string().optional(),
  vercelToken: z.string().optional(),
  customDomain: z.string().optional(),
  creditCount: z.number().min(0).optional(),
  // Proxy URLs for v0 and Vercel API (Cloudflare Workers reverse proxy)
  v0BaseUrl: z.url().optional(),
  vercelBaseUrl: z.url().optional(),
  // Vercel AI Gateway configuration
  aiGatewayApiKey: z.string().optional(),
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
