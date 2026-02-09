import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { mailTransportConfigSchema } from '../../mail';
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
  // Vercel AI Gateway - unified model access via modelId
  AI_GATEWAY = 'aiGateway',
}

// Gateway model type from API (language, embedding, image)
export const GatewayModelTypeValues = ['language', 'embedding', 'image'] as const;
export type GatewayModelType = (typeof GatewayModelTypeValues)[number];
export const gatewayModelTypeSchema = z.enum(GatewayModelTypeValues);

// Gateway model capability tags from API
export const GatewayModelTagValues = [
  'reasoning',
  'tool-use',
  'vision',
  'file-input',
  'image-generation',
  'implicit-caching',
] as const;
export type GatewayModelTag = (typeof GatewayModelTagValues)[number];
export const gatewayModelTagSchema = z.enum(GatewayModelTagValues);

// Gateway model provider (owned_by) from API
export const GatewayModelProviderValues = [
  'alibaba',
  'amazon',
  'anthropic',
  'arcee-ai',
  'bfl',
  'bytedance',
  'cohere',
  'deepseek',
  'google',
  'inception',
  'kwaipilot',
  'meituan',
  'meta',
  'minimax',
  'mistral',
  'moonshotai',
  'morph',
  'nvidia',
  'openai',
  'perplexity',
  'prime-intellect',
  'stealth',
  'vercel',
  'voyage',
  'xai',
  'xiaomi',
  'zai',
] as const;
export type GatewayModelProvider = (typeof GatewayModelProviderValues)[number];
export const gatewayModelProviderSchema = z.enum(GatewayModelProviderValues);

// Detailed ability support with URL and base64 variants
export const abilityDetailSchema = z.object({
  url: z.boolean().optional(),
  base64: z.boolean().optional(),
});

export type IAbilityDetail = z.infer<typeof abilityDetailSchema>;

// Model ability schema for test results
export const modelAbilitySchema = z.object({
  image: z.union([z.boolean(), abilityDetailSchema]).optional(), // vision/image input
  pdf: z.union([z.boolean(), abilityDetailSchema]).optional(), // PDF/file input
  webSearch: z.boolean().optional(),
  toolCall: z.boolean().optional(), // tool/function calling
  reasoning: z.boolean().optional(), // extended thinking/reasoning
  imageGeneration: z.boolean().optional(), // can generate images
});

export type IModelAbility = z.infer<typeof modelAbilitySchema>;

// Image model ability schema
export const imageModelAbilitySchema = z.object({
  generation: z.boolean().optional(), // can generate images from text
  imageToImage: z.boolean().optional(), // can generate images from image input
});

export type IImageModelAbility = z.infer<typeof imageModelAbilitySchema>;

// Unified pricing schema - USD per token (string format, same as Vercel AI Gateway API)
// Credit calculation: credits = tokens * parseFloat(price) / TOKEN_TO_CREDIT_RATE
export const pricingSchema = z.object({
  input: z.string().optional(), // USD per input token, e.g., "0.000003"
  output: z.string().optional(), // USD per output token, e.g., "0.000015"
  inputCacheRead: z.string().optional(), // USD per cached input token
  inputCacheWrite: z.string().optional(), // USD per cache write token
  reasoning: z.string().optional(), // USD per reasoning token (e.g., o1 models)
  image: z.string().optional(), // USD per image (for image generation)
  webSearch: z.string().optional(), // USD per web search query (e.g., "10")
});

export type IModelPricing = z.infer<typeof pricingSchema>;

// Legacy rates schema (credits per 1M tokens) - for backward compatibility
// Will be converted to new pricing format when reading
export const legacyRatesSchema = z.object({
  inputRate: z.number().min(0).optional(),
  outputRate: z.number().min(0).optional(),
  cacheReadRate: z.number().min(0).optional(),
  cacheWriteRate: z.number().min(0).optional(),
  reasoningRate: z.number().min(0).optional(),
  imageRate: z.number().min(0).optional(),
  webSearchRate: z.number().min(0).optional(),
});

export type ILegacyRates = z.infer<typeof legacyRatesSchema>;

// Conversion constants
// 1 credit = $0.001 USD (100 credits = $1)
export const USD_PER_CREDIT = 0.01;
// Legacy rates were in credits per 1M tokens
export const TOKENS_PER_RATE_UNIT = 1_000_000;

// Convert new pricing (USD/token) to credits for billing
export function pricingToCredits(
  pricing: IModelPricing | undefined,
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    images?: number;
    webSearches?: number;
  }
): number {
  if (!pricing) return 0;

  let totalUsd = 0;

  if (pricing.input && usage.inputTokens) {
    totalUsd += parseFloat(pricing.input) * usage.inputTokens;
  }
  if (pricing.output && usage.outputTokens) {
    totalUsd += parseFloat(pricing.output) * usage.outputTokens;
  }
  if (pricing.inputCacheRead && usage.cacheReadTokens) {
    totalUsd += parseFloat(pricing.inputCacheRead) * usage.cacheReadTokens;
  }
  if (pricing.inputCacheWrite && usage.cacheWriteTokens) {
    totalUsd += parseFloat(pricing.inputCacheWrite) * usage.cacheWriteTokens;
  }
  if (pricing.reasoning && usage.reasoningTokens) {
    totalUsd += parseFloat(pricing.reasoning) * usage.reasoningTokens;
  }
  if (pricing.image && usage.images) {
    totalUsd += parseFloat(pricing.image) * usage.images;
  }
  if (pricing.webSearch && usage.webSearches) {
    totalUsd += parseFloat(pricing.webSearch) * usage.webSearches;
  }

  // Convert USD to credits
  return totalUsd / USD_PER_CREDIT;
}

/**
 * AI SDK LanguageModelUsage compatible interface
 * This is a subset of the AI SDK's LanguageModelUsage type
 */
export interface IAIModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    noCacheTokens?: number;
  };
  outputTokenDetails?: {
    reasoningTokens?: number;
    textTokens?: number;
  };
}

/**
 * Calculate credits from AI SDK LanguageModelUsage
 * Supports detailed token breakdown (cached tokens, reasoning tokens, etc.)
 * Round up to 2 decimal places
 */
export function pricingToCreditsFromUsage(
  pricing: IModelPricing | undefined,
  usage: IAIModelUsage
): number {
  if (!pricing) return 0;

  // Extract detailed token info
  const inputDetails = usage.inputTokenDetails || {};
  const outputDetails = usage.outputTokenDetails || {};

  // Calculate INPUT token counts (avoid double counting)
  // inputTokens = noCacheTokens + cacheReadTokens
  const totalInputTokens = usage.inputTokens ?? 0;
  const cacheReadTokens = inputDetails.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
  const cacheWriteTokens = inputDetails.cacheWriteTokens ?? 0;
  const noCacheTokens =
    inputDetails.noCacheTokens ?? Math.max(0, totalInputTokens - cacheReadTokens);

  // Calculate OUTPUT token counts (avoid double counting)
  // outputTokens = textTokens + reasoningTokens
  const totalOutputTokens = usage.outputTokens ?? 0;
  const reasoningTokens = outputDetails.reasoningTokens ?? usage.reasoningTokens ?? 0;
  const textOutputTokens =
    outputDetails.textTokens ?? Math.max(0, totalOutputTokens - reasoningTokens);

  const credits = pricingToCredits(pricing, {
    inputTokens: noCacheTokens,
    outputTokens: textOutputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  });

  // Round up to 2 decimal places
  return Math.ceil(credits * 100) / 100;
}

// Model-specific configuration - unified structure for all model types
// Supports both new pricing (USD) and legacy rates (credits/1M) for backward compatibility
export const modelConfigSchema = z.object({
  // === Display name (optional, falls back to model ID if not set) ===
  label: z.string().optional(),

  // === Pricing in USD (new format - preferred) ===
  pricing: pricingSchema.optional(),

  // === Legacy rates in credits per 1M tokens (deprecated, for backward compat) ===
  // @deprecated Use pricing instead. Will be auto-converted to pricing when reading.
  inputRate: z.number().min(0).optional(),
  outputRate: z.number().min(0).optional(),
  cacheReadRate: z.number().min(0).optional(),
  cacheWriteRate: z.number().min(0).optional(),
  reasoningRate: z.number().min(0).optional(),
  imageRate: z.number().min(0).optional(),
  webSearchRate: z.number().min(0).optional(),

  // === Model type flags ===
  isImageModel: z.boolean().optional(),

  // === Test results (from actual testing) ===
  ability: modelAbilitySchema.optional(),
  imageAbility: imageModelAbilitySchema.optional(),
  testedAt: z.number().optional(),

  // === API metadata (unified with gateway models) ===
  ownedBy: gatewayModelProviderSchema.optional(), // e.g., "openai", "anthropic", "google"
  modelType: gatewayModelTypeSchema.optional(), // e.g., "language", "image"
  tags: z.array(gatewayModelTagSchema).optional(), // e.g., ["vision", "tool-use", "reasoning"]
  contextWindow: z.number().optional(), // max input tokens
  maxTokens: z.number().optional(), // max output tokens
  description: z.string().optional(), // model description
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

// Gateway model default assignment targets
export enum GatewayModelDefaultFor {
  CHAT_LG = 'chatLg',
  CHAT_MD = 'chatMd',
  CHAT_SM = 'chatSm',
  AI_FIELD_TEXT = 'aiFieldText',
  AI_FIELD_IMAGE = 'aiFieldImage',
}

// Individual gateway model configuration (admin-maintained)
export const gatewayModelSchema = z.object({
  // modelId used directly with AI Gateway (e.g., "anthropic/claude-sonnet-4")
  id: z.string(),
  // Display label (e.g., "Claude Sonnet 4")
  label: z.string(),
  // Whether this model is visible to end users
  enabled: z.boolean().default(true),
  // Model capabilities (for UI tags and validation)
  capabilities: modelAbilitySchema.optional(),
  // Pricing in USD (new unified format)
  pricing: pricingSchema.optional(),
  // @deprecated Legacy rates in credits per 1M tokens - use pricing instead
  rates: legacyRatesSchema.optional(),
  // Mark as image generation model
  isImageModel: z.boolean().optional(),
  // Default assignment (which use cases this model is default for)
  defaultFor: z.array(z.nativeEnum(GatewayModelDefaultFor)).optional(),
  // Last test timestamp
  testedAt: z.number().optional(),
  // === Metadata from AI Gateway API ===
  // Provider that owns this model (e.g., "anthropic", "google", "openai")
  ownedBy: gatewayModelProviderSchema.optional(),
  // Model type from API (e.g., "language", "image")
  modelType: gatewayModelTypeSchema.optional(),
  // Capability tags from API (e.g., ["image-generation", "vision", "tool-use"])
  tags: z.array(gatewayModelTagSchema).optional(),
  // Context window size (input tokens)
  contextWindow: z.number().optional(),
  // Maximum output tokens
  maxTokens: z.number().optional(),
  // Model description
  description: z.string().optional(),
});

export type IGatewayModel = z.infer<typeof gatewayModelSchema>;

/* eslint-disable @typescript-eslint/naming-convention */
// Raw API response structure from Vercel AI Gateway (snake_case as returned by API)
export const gatewayApiModelRawSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  type: gatewayModelTypeSchema.optional(),
  tags: z.array(gatewayModelTagSchema).optional(),
  context_window: z.number().optional(),
  max_tokens: z.number().optional(),
  created: z.number().optional(),
  owned_by: gatewayModelProviderSchema.optional(),
  pricing: pricingSchema.optional(),
});
/* eslint-enable @typescript-eslint/naming-convention */

export type IGatewayApiModelRaw = z.infer<typeof gatewayApiModelRawSchema>;

// Gateway API model structure (camelCase, converted from API snake_case)
export const gatewayApiModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  type: gatewayModelTypeSchema.optional(),
  tags: z.array(gatewayModelTagSchema).optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  created: z.number().optional(),
  ownedBy: gatewayModelProviderSchema.optional(),
  pricing: pricingSchema.optional(),
});

export type IGatewayApiModel = z.infer<typeof gatewayApiModelSchema>;

// Helper function to convert raw API response to camelCase
export function convertGatewayApiModel(raw: IGatewayApiModelRaw): IGatewayApiModel {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    type: raw.type,
    tags: raw.tags,
    contextWindow: raw.context_window,
    maxTokens: raw.max_tokens,
    created: raw.created,
    ownedBy: raw.owned_by,
    pricing: raw.pricing,
  };
}

// Attachment transfer mode test result for a single mode
export const attachmentModeTestResultSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

export type IAttachmentModeTestResult = z.infer<typeof attachmentModeTestResultSchema>;

// Attachment transfer test results (from dual-mode testing)
export const attachmentTestSchema = z.object({
  // URL mode test result
  urlMode: attachmentModeTestResultSchema.optional(),
  // Base64 mode test result
  base64Mode: attachmentModeTestResultSchema.optional(),
  // Last test time (ISO 8601)
  testedAt: z.string().optional(),
  // PUBLIC_ORIGIN at test time (to detect config changes)
  testedOrigin: z.string().optional(),
  // Recommended mode based on test results
  recommendedMode: z.enum(['url', 'base64']).optional(),
});

export type IAttachmentTest = z.infer<typeof attachmentTestSchema>;

// Attachment transfer mode values
export const AttachmentTransferModeValues = ['url', 'base64'] as const;
export type AttachmentTransferMode = (typeof AttachmentTransferModeValues)[number];
export const attachmentTransferModeSchema = z.enum(AttachmentTransferModeValues);

export const aiConfigSchema = z.object({
  llmProviders: z.array(llmProviderSchema).default([]),
  embeddingModel: z.string().optional(),
  translationModel: z.string().optional(),
  chatModel: chatModelSchema.optional(),
  // AI Gateway models (admin-maintained, recommended for Cloud)
  gatewayModels: z.array(gatewayModelSchema).optional(),
  capabilities: z
    .object({
      disableActions: z.array(z.string()).optional(),
    })
    .optional(),
  // Vercel AI Gateway configuration
  aiGatewayApiKey: z.string().optional(),
  // AI Gateway base URL (defaults to Vercel's gateway if not set)
  aiGatewayBaseUrl: z.url().optional(),
  // Attachment transfer test results (from dual-mode testing)
  attachmentTest: attachmentTestSchema.optional(),
  // Attachment transfer mode: 'url' (default) or 'base64'
  attachmentTransferMode: attachmentTransferModeSchema.default('url').optional(),
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
});

export type IAppConfig = z.infer<typeof appConfigSchema>;

export const webSearchConfigSchema = z.object({
  apiKey: z.string().optional(),
});

export type IWebSearchConfig = z.infer<typeof webSearchConfigSchema>;

// V2 feature names for canary control
export const v2FeatureSchema = z.enum([
  'createRecord',
  'formSubmit',
  'updateRecord',
  'updateRecords',
  'deleteRecord',
  'duplicateRecord',
  'reorderRecords',
  'paste',
  'clear',
  'importRecords',
]);

export type V2Feature = z.infer<typeof v2FeatureSchema>;

export const canaryConfigSchema = z.object({
  enabled: z.boolean(),
  spaceIds: z.array(z.string()).default([]),
  // Force all requests to use V2 (highest priority)
  forceV2All: z.boolean().optional(),
});

export type ICanaryConfig = z.infer<typeof canaryConfigSchema>;

// Header name for canary release override
export const X_CANARY_HEADER = 'x-teable-canary';

export const updateSettingRoSchema = z.object({
  disallowSignUp: z.boolean().optional(),
  disallowSpaceCreation: z.boolean().optional(),
  disallowSpaceInvitation: z.boolean().optional(),
  enableEmailVerification: z.boolean().optional(),
  enableCreditReward: z.boolean().optional(),
  aiConfig: aiConfigVoSchema.optional(),
  enableWaitlist: z.boolean().optional(),
  appConfig: appConfigSchema.optional(),
  brandName: z.string().optional(),
  canaryConfig: canaryConfigSchema.optional(),
  notifyMailTransportConfig: mailTransportConfigSchema.nullable().optional(),
  automationMailTransportConfig: mailTransportConfigSchema.nullable().optional(),
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
