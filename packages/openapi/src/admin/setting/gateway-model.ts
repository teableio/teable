/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';
import { modelAbilitySchema } from './model-ability';
import {
  legacyRatesSchema,
  normalizeGatewayPricing,
  pricingSchema,
  rawPricingSchema,
} from './pricing';

// Gateway model type from API (language, embedding, image)
export const GatewayModelTypeValues = ['language', 'embedding', 'image'] as const;
export type GatewayModelType = (typeof GatewayModelTypeValues)[number];
export const gatewayModelTypeSchema = z.enum(GatewayModelTypeValues);

// Known gateway model capability tags from API.
// Tags are external API metadata, so validation accepts any non-empty string for forward compatibility.
export const GatewayModelTagValues = [
  'reasoning',
  'tool-use',
  'vision',
  'file-input',
  'image-generation',
  'implicit-caching',
  'explicit-caching',
  'web-search',
] as const;
export type KnownGatewayModelTag = (typeof GatewayModelTagValues)[number];
export type GatewayModelTag = string;
export const gatewayModelTagSchema = z.string().min(1);

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
  'prodia',
  'recraft',
  'stealth',
  'vercel',
  'voyage',
  'xai',
  'xiaomi',
  'zai',
] as const;
export type GatewayModelProvider = (typeof GatewayModelProviderValues)[number];
export const gatewayModelProviderSchema = z.enum(GatewayModelProviderValues);

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
  // Admin-curated i18n description (e.g., "Most capable for ambitious work")
  i18nDescription: z
    .object({
      en: z.string().optional(),
      zh: z.string().optional(),
    })
    .optional(),
});

export type IGatewayModel = z.infer<typeof gatewayModelSchema>;

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
  pricing: rawPricingSchema.optional(),
});

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
    pricing: normalizeGatewayPricing(raw.pricing),
  };
}
