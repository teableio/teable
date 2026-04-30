import { z } from 'zod';

// Tiered pricing tier - for volume-based pricing where cost changes at token thresholds
export const pricingTierSchema = z.object({
  cost: z.string(), // USD per token at this tier
  min: z.number(), // Tier start (inclusive)
  max: z.number().optional(), // Tier end (absent = open-ended last tier)
});

export type IPricingTier = z.infer<typeof pricingTierSchema>;

// Unified pricing schema - USD per token (string format, same as Vercel AI Gateway API)
// 100 credits = $1 USD. Credits = totalUSD / USD_PER_CREDIT
export const pricingSchema = z.object({
  // Flat rates (USD per token/unit as string)
  input: z.string().optional(),
  output: z.string().optional(),
  inputCacheRead: z.string().optional(),
  inputCacheWrite: z.string().optional(),
  reasoning: z.string().optional(),
  image: z.string().optional(),
  webSearch: z.string().optional(),

  // Tiered pricing (overrides flat rate when present)
  inputTiers: z.array(pricingTierSchema).optional(),
  outputTiers: z.array(pricingTierSchema).optional(),
  inputCacheReadTiers: z.array(pricingTierSchema).optional(),
  inputCacheWriteTiers: z.array(pricingTierSchema).optional(),
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
// 1 credit = $0.01 USD (100 credits = $1)
export const USD_PER_CREDIT = 0.01;
// Legacy rates were in credits per 1M tokens
export const TOKENS_PER_RATE_UNIT = 1_000_000;

/**
 * Calculate cost for tokens using tiered (progressive) pricing.
 * Each tier covers a range [min, max). The last tier has no max (open-ended).
 */
export function calculateTieredCost(tokenCount: number, tiers: IPricingTier[]): number {
  let totalCost = 0;
  for (const tier of tiers) {
    if (tokenCount <= tier.min) break;
    const tierMax = tier.max ?? Infinity;
    const tokensInTier = Math.min(tokenCount, tierMax) - tier.min;
    totalCost += tokensInTier * parseFloat(tier.cost);
  }
  return totalCost;
}

/**
 * Calculate USD cost for a single pricing category.
 * Uses tiered pricing if available, otherwise falls back to flat rate.
 */
function categoryUsd(
  tokenCount: number | undefined,
  flatRate: string | undefined,
  tiers: IPricingTier[] | undefined
): number {
  if (!tokenCount) return 0;
  if (tiers?.length) return calculateTieredCost(tokenCount, tiers);
  if (flatRate) return parseFloat(flatRate) * tokenCount;
  return 0;
}

// Convert pricing (USD/token) to credits for billing
// 100 credits = $1 USD
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

  totalUsd += categoryUsd(usage.inputTokens, pricing.input, pricing.inputTiers);
  totalUsd += categoryUsd(usage.outputTokens, pricing.output, pricing.outputTiers);
  totalUsd += categoryUsd(
    usage.cacheReadTokens,
    pricing.inputCacheRead,
    pricing.inputCacheReadTiers
  );
  totalUsd += categoryUsd(
    usage.cacheWriteTokens,
    pricing.inputCacheWrite,
    pricing.inputCacheWriteTiers
  );
  totalUsd += categoryUsd(usage.reasoningTokens, pricing.reasoning, undefined);

  if (pricing.image && usage.images) {
    totalUsd += parseFloat(pricing.image) * usage.images;
  }
  if (pricing.webSearch && usage.webSearches) {
    // pricing.webSearch is USD per 1,000 searches
    totalUsd += (parseFloat(pricing.webSearch) * usage.webSearches) / 1000;
  }

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

/* eslint-disable @typescript-eslint/naming-convention */
// Raw pricing schema matching Vercel AI Gateway API response (snake_case)
// @see https://ai-gateway.vercel.sh/v1/models
export const rawPricingSchema = z.object({
  // Flat rates (USD per token/unit as string)
  input: z.string().optional(),
  output: z.string().optional(),
  input_cache_read: z.string().optional(),
  input_cache_write: z.string().optional(),
  reasoning: z.string().optional(),
  image: z.string().optional(),
  web_search: z.string().optional(),

  // Tiered pricing (overrides flat rate when present)
  input_tiers: z.array(pricingTierSchema).optional(),
  output_tiers: z.array(pricingTierSchema).optional(),
  input_cache_read_tiers: z.array(pricingTierSchema).optional(),
  input_cache_write_tiers: z.array(pricingTierSchema).optional(),
});
/* eslint-enable @typescript-eslint/naming-convention */

export type IRawPricing = z.infer<typeof rawPricingSchema>;

// Field mappings: [snakeCase, camelCase] pairs for pricing normalization
const PRICING_STRING_FIELDS: [string, keyof IModelPricing][] = [
  ['input', 'input'],
  ['output', 'output'],
  ['reasoning', 'reasoning'],
  ['image', 'image'],
  ['input_cache_read', 'inputCacheRead'],
  ['input_cache_write', 'inputCacheWrite'],
  ['web_search', 'webSearch'],
];

const PRICING_TIER_FIELDS: [string, keyof IModelPricing][] = [
  ['input_tiers', 'inputTiers'],
  ['output_tiers', 'outputTiers'],
  ['input_cache_read_tiers', 'inputCacheReadTiers'],
  ['input_cache_write_tiers', 'inputCacheWriteTiers'],
];

/**
 * Normalize a pricing object from any source (gateway API snake_case or admin config camelCase)
 * into our canonical camelCase IModelPricing format.
 */
export function normalizeGatewayPricing(
  raw: IRawPricing | IModelPricing | Record<string, unknown> | undefined
): IModelPricing | undefined {
  if (!raw || Object.keys(raw).length === 0) return undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pricing: Record<string, any> = {};

  for (const [snake, camel] of PRICING_STRING_FIELDS) {
    const val = r[snake] ?? (snake !== camel ? r[camel] : undefined);
    if (val != null) pricing[camel] = String(val);
  }

  for (const [snake, camel] of PRICING_TIER_FIELDS) {
    const val = r[snake] ?? (snake !== camel ? r[camel] : undefined);
    if (Array.isArray(val)) pricing[camel] = val;
  }

  return Object.keys(pricing).length > 0 ? (pricing as IModelPricing) : undefined;
}
