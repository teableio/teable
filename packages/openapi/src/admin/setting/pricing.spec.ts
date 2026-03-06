/* eslint-disable sonarjs/no-duplicate-string */
import { describe, it, expect } from 'vitest';
import type { IModelPricing, IPricingTier } from './update';
import {
  calculateTieredCost,
  pricingToCredits,
  pricingToCreditsFromUsage,
  normalizeGatewayPricing,
  USD_PER_CREDIT,
} from './update';

describe('pricing', () => {
  describe('USD_PER_CREDIT', () => {
    it('should be $0.01 (100 credits = $1)', () => {
      expect(USD_PER_CREDIT).toBe(0.01);
      expect(1 / USD_PER_CREDIT).toBe(100);
    });
  });

  describe('calculateTieredCost', () => {
    const tiers: IPricingTier[] = [
      { cost: '0.000003', min: 0, max: 200001 },
      { cost: '0.000006', min: 200001 },
    ];

    it('should calculate cost within first tier', () => {
      const cost = calculateTieredCost(100000, tiers);
      expect(cost).toBeCloseTo(100000 * 0.000003);
    });

    it('should calculate cost spanning two tiers', () => {
      const cost = calculateTieredCost(300000, tiers);
      const expected = 200001 * 0.000003 + (300000 - 200001) * 0.000006;
      expect(cost).toBeCloseTo(expected);
    });

    it('should return 0 for 0 tokens', () => {
      expect(calculateTieredCost(0, tiers)).toBe(0);
    });

    it('should handle single-tier (no max)', () => {
      const singleTier: IPricingTier[] = [{ cost: '0.000001', min: 0 }];
      expect(calculateTieredCost(50000, singleTier)).toBeCloseTo(50000 * 0.000001);
    });

    it('should handle multi-tier (Anthropic claude-opus-4.6 style)', () => {
      // Real pricing from AI Gateway: anthropic/claude-opus-4.6
      const inputTiers: IPricingTier[] = [
        { cost: '0.000005', min: 0, max: 200001 },
        { cost: '0.00001', min: 200001 },
      ];
      // 250K tokens: 200001 at $5/M + 49999 at $10/M
      const cost = calculateTieredCost(250000, inputTiers);
      const expected = 200001 * 0.000005 + 49999 * 0.00001;
      expect(cost).toBeCloseTo(expected);
    });

    it('should handle 4-tier pricing (qwen3-coder-plus style)', () => {
      const tiers4: IPricingTier[] = [
        { cost: '0.000001', min: 0, max: 32001 },
        { cost: '0.0000018', min: 32001, max: 128001 },
        { cost: '0.000003', min: 128001, max: 256001 },
        { cost: '0.000006', min: 256001 },
      ];
      // 300K tokens spans all 4 tiers
      const cost = calculateTieredCost(300000, tiers4);
      const expected =
        32001 * 0.000001 +
        (128001 - 32001) * 0.0000018 +
        (256001 - 128001) * 0.000003 +
        (300000 - 256001) * 0.000006;
      expect(cost).toBeCloseTo(expected);
    });
  });

  describe('pricingToCredits', () => {
    it('should return 0 for undefined pricing', () => {
      expect(pricingToCredits(undefined, { inputTokens: 1000 })).toBe(0);
    });

    it('should convert flat-rate input+output to credits (100 credits = $1)', () => {
      const pricing: IModelPricing = {
        input: '0.000003', // $3/M tokens
        output: '0.000015', // $15/M tokens
      };
      // 10K input + 5K output
      // = 10000 * $0.000003 + 5000 * $0.000015
      // = $0.03 + $0.075 = $0.105
      // = $0.105 / $0.01 = 10.5 credits
      const credits = pricingToCredits(pricing, {
        inputTokens: 10000,
        outputTokens: 5000,
      });
      expect(credits).toBeCloseTo(10.5);
    });

    it('should handle cache pricing', () => {
      const pricing: IModelPricing = {
        input: '0.000003',
        output: '0.000015',
        inputCacheRead: '0.0000003', // 10% of input
        inputCacheWrite: '0.00000375', // 125% of input
      };
      const credits = pricingToCredits(pricing, {
        inputTokens: 5000,
        outputTokens: 1000,
        cacheReadTokens: 10000,
        cacheWriteTokens: 2000,
      });
      const expectedUsd = 5000 * 0.000003 + 1000 * 0.000015 + 10000 * 0.0000003 + 2000 * 0.00000375;
      expect(credits).toBeCloseTo(expectedUsd / USD_PER_CREDIT);
    });

    it('should use tiered pricing when available (overrides flat rate)', () => {
      const pricing: IModelPricing = {
        input: '0.000003', // flat rate (ignored when tiers present)
        inputTiers: [
          { cost: '0.000003', min: 0, max: 200001 },
          { cost: '0.000006', min: 200001 },
        ],
        output: '0.000015',
      };
      // 250K input tokens spans tiers
      const credits = pricingToCredits(pricing, {
        inputTokens: 250000,
        outputTokens: 1000,
      });
      const expectedUsd = 200001 * 0.000003 + (250000 - 200001) * 0.000006 + 1000 * 0.000015;
      expect(credits).toBeCloseTo(expectedUsd / USD_PER_CREDIT);
    });

    it('should handle web search pricing', () => {
      const pricing: IModelPricing = {
        input: '0.0000001',
        output: '0.0000004',
        webSearch: '35',
      };
      const credits = pricingToCredits(pricing, {
        inputTokens: 1000,
        outputTokens: 500,
        webSearches: 2,
      });
      const expectedUsd = 1000 * 0.0000001 + 500 * 0.0000004 + 2 * 35;
      expect(credits).toBeCloseTo(expectedUsd / USD_PER_CREDIT);
    });

    it('should handle image pricing', () => {
      const pricing: IModelPricing = {
        image: '0.04',
      };
      // 3 images at $0.04 each = $0.12 = 12 credits
      expect(pricingToCredits(pricing, { images: 3 })).toBeCloseTo(12);
    });

    it('should handle reasoning tokens', () => {
      const pricing: IModelPricing = {
        input: '0.000003',
        output: '0.000015',
        reasoning: '0.000015',
      };
      const credits = pricingToCredits(pricing, {
        inputTokens: 1000,
        outputTokens: 500,
        reasoningTokens: 2000,
      });
      const expectedUsd = 1000 * 0.000003 + 500 * 0.000015 + 2000 * 0.000015;
      expect(credits).toBeCloseTo(expectedUsd / USD_PER_CREDIT);
    });
  });

  describe('pricingToCreditsFromUsage', () => {
    it('should decompose AI SDK usage into categories and calculate credits', () => {
      const pricing: IModelPricing = {
        input: '0.000003',
        output: '0.000015',
        inputCacheRead: '0.0000003',
      };
      // totalInput=15000, cached=10000 → nonCached=5000
      // totalOutput=3000, reasoning=1000 → text=2000
      const credits = pricingToCreditsFromUsage(pricing, {
        inputTokens: 15000,
        outputTokens: 3000,
        reasoningTokens: 1000,
        cachedInputTokens: 10000,
      });
      const expectedUsd =
        5000 * 0.000003 + // non-cached input
        2000 * 0.000015 + // text output
        10000 * 0.0000003 + // cache read
        1000 * 0; // reasoning (no pricing set → 0)
      expect(credits).toBeCloseTo(Math.ceil((expectedUsd / USD_PER_CREDIT) * 100) / 100);
    });

    it('should handle usage with inputTokenDetails', () => {
      const pricing: IModelPricing = {
        input: '0.000005',
        output: '0.000025',
        inputCacheRead: '0.0000005',
        inputCacheWrite: '0.00000625',
      };
      const credits = pricingToCreditsFromUsage(pricing, {
        inputTokens: 20000,
        outputTokens: 5000,
        inputTokenDetails: {
          cacheReadTokens: 15000,
          cacheWriteTokens: 3000,
          noCacheTokens: 5000,
        },
        outputTokenDetails: {
          reasoningTokens: 2000,
          textTokens: 3000,
        },
      });
      const expectedUsd =
        5000 * 0.000005 + // non-cached input
        3000 * 0.000025 + // text output
        15000 * 0.0000005 + // cache read
        3000 * 0.00000625; // cache write
      // Note: reasoning = 0 because no reasoning pricing
      const expectedCredits = Math.ceil((expectedUsd / USD_PER_CREDIT) * 100) / 100;
      expect(credits).toBeCloseTo(expectedCredits);
    });
  });

  describe('normalizeGatewayPricing', () => {
    it('should return undefined for empty/undefined input', () => {
      expect(normalizeGatewayPricing(undefined)).toBeUndefined();
      expect(normalizeGatewayPricing({})).toBeUndefined();
    });

    it('should pass through simple fields unchanged', () => {
      const result = normalizeGatewayPricing({
        input: '0.000003',
        output: '0.000015',
      });
      expect(result).toEqual({
        input: '0.000003',
        output: '0.000015',
      });
    });

    it('should convert snake_case to camelCase', () => {
      const result = normalizeGatewayPricing({
        input: '0.000003',
        output: '0.000015',
        input_cache_read: '0.0000003',
        input_cache_write: '0.00000375',
        web_search: '35',
      });
      expect(result).toEqual({
        input: '0.000003',
        output: '0.000015',
        inputCacheRead: '0.0000003',
        inputCacheWrite: '0.00000375',
        webSearch: '35',
      });
    });

    it('should accept already-camelCase input (admin config)', () => {
      const result = normalizeGatewayPricing({
        input: '0.000003',
        output: '0.000015',
        inputCacheRead: '0.0000003',
        webSearch: '10',
      });
      expect(result).toEqual({
        input: '0.000003',
        output: '0.000015',
        inputCacheRead: '0.0000003',
        webSearch: '10',
      });
    });

    it('should convert tiered pricing from snake_case', () => {
      const result = normalizeGatewayPricing({
        input: '0.000005',
        input_tiers: [
          { cost: '0.000005', min: 0, max: 200001 },
          { cost: '0.00001', min: 200001 },
        ],
        output: '0.000025',
        output_tiers: [
          { cost: '0.000025', min: 0, max: 200001 },
          { cost: '0.0000375', min: 200001 },
        ],
        input_cache_read: '0.0000005',
        input_cache_read_tiers: [
          { cost: '0.0000005', min: 0, max: 200001 },
          { cost: '0.000001', min: 200001 },
        ],
      });
      expect(result?.inputTiers).toHaveLength(2);
      expect(result?.outputTiers).toHaveLength(2);
      expect(result?.inputCacheReadTiers).toHaveLength(2);
      expect(result?.inputCacheRead).toBe('0.0000005');
    });

    it('should stringify non-string price values', () => {
      const result = normalizeGatewayPricing({
        input: 0.000003 as unknown,
        output: '0.000015',
      });
      expect(result?.input).toBe('0.000003');
      expect(result?.output).toBe('0.000015');
    });
  });

  describe('real-world pricing patterns', () => {
    it('Pattern 1: simple input+output (qwen-3-14b)', () => {
      const pricing: IModelPricing = { input: '0.00000006', output: '0.00000024' };
      // 50K in + 10K out
      const credits = pricingToCredits(pricing, { inputTokens: 50000, outputTokens: 10000 });
      const usd = 50000 * 0.00000006 + 10000 * 0.00000024;
      expect(credits).toBeCloseTo(usd / USD_PER_CREDIT);
    });

    it('Pattern 2: with cache read (deepseek-r1)', () => {
      const pricing: IModelPricing = {
        input: '0.00000022',
        output: '0.00000088',
        inputCacheRead: '0.00000011',
      };
      const credits = pricingToCreditsFromUsage(pricing, {
        inputTokens: 100000,
        outputTokens: 5000,
        cachedInputTokens: 80000,
      });
      const usd = 20000 * 0.00000022 + 5000 * 0.00000088 + 80000 * 0.00000011;
      expect(credits).toBeCloseTo(Math.ceil((usd / USD_PER_CREDIT) * 100) / 100);
    });

    it('Pattern 3: Anthropic with full cache + tiers + web search (claude-opus-4.6)', () => {
      const pricing: IModelPricing = {
        input: '0.000005',
        inputTiers: [
          { cost: '0.000005', min: 0, max: 200001 },
          { cost: '0.00001', min: 200001 },
        ],
        output: '0.000025',
        outputTiers: [
          { cost: '0.000025', min: 0, max: 200001 },
          { cost: '0.0000375', min: 200001 },
        ],
        inputCacheRead: '0.0000005',
        inputCacheReadTiers: [
          { cost: '0.0000005', min: 0, max: 200001 },
          { cost: '0.000001', min: 200001 },
        ],
        inputCacheWrite: '0.00000625',
        inputCacheWriteTiers: [
          { cost: '0.00000625', min: 0, max: 200001 },
          { cost: '0.0000125', min: 200001 },
        ],
        webSearch: '10',
      };
      // Small request within first tier
      const credits = pricingToCredits(pricing, {
        inputTokens: 10000,
        outputTokens: 2000,
        cacheReadTokens: 5000,
      });
      const usd = 10000 * 0.000005 + 2000 * 0.000025 + 5000 * 0.0000005;
      expect(credits).toBeCloseTo(usd / USD_PER_CREDIT);
    });

    it('Pattern 4: tiered without cache (bytedance/seed-1.6)', () => {
      const pricing: IModelPricing = {
        input: '0.00000025',
        inputTiers: [
          { cost: '0.00000025', min: 0, max: 128001 },
          { cost: '0.0000005', min: 128001 },
        ],
        output: '0.000002',
        outputTiers: [
          { cost: '0.000002', min: 0, max: 128001 },
          { cost: '0.000004', min: 128001 },
        ],
        inputCacheRead: '0.00000005',
      };
      // 200K input tokens (spans tiers)
      const credits = pricingToCredits(pricing, {
        inputTokens: 200000,
        outputTokens: 50000,
      });
      const inputUsd = 128001 * 0.00000025 + (200000 - 128001) * 0.0000005;
      const outputUsd = 50000 * 0.000002; // within first tier
      expect(credits).toBeCloseTo((inputUsd + outputUsd) / USD_PER_CREDIT);
    });

    it('Pattern 5: Google with web search (gemini-2.0-flash)', () => {
      const pricing: IModelPricing = {
        input: '0.0000001',
        output: '0.0000004',
        inputCacheRead: '0.000000025',
        webSearch: '35',
      };
      const credits = pricingToCredits(pricing, {
        inputTokens: 5000,
        outputTokens: 1000,
        webSearches: 1,
      });
      const usd = 5000 * 0.0000001 + 1000 * 0.0000004 + 1 * 35;
      expect(credits).toBeCloseTo(usd / USD_PER_CREDIT);
    });
  });
});
