import { describe, expect, it } from 'vitest';
import {
  isMiniMaxMessagesEndpoint,
  llmProviderSchema,
  LLMProviderType,
  MINIMAX_DEFAULT_MODEL_CONFIGS,
  MINIMAX_MODEL_IDS,
  MINIMAX_PROVIDER_ENDPOINTS,
  modelKeySchema,
} from './update';
import { gatewayApiModelRawSchema, getImageModelTagsFromAbility } from './index';

const IMAGE_GENERATION_TAG = 'image-generation';

describe('setting index exports', () => {
  it('re-exports model ability helpers from the setting barrel', () => {
    expect(
      getImageModelTagsFromAbility(
        {
          generation: true,
          imageToImage: true,
        },
        undefined
      )
    ).toEqual([IMAGE_GENERATION_TAG, 'vision']);
  });

  it('accepts current AI Gateway image model providers', () => {
    expect(
      gatewayApiModelRawSchema.parse({
        id: 'prodia/flux-fast-schnell',
        type: 'image',
        owned_by: 'prodia',
        tags: [IMAGE_GENERATION_TAG],
      }).owned_by
    ).toBe('prodia');
    expect(
      gatewayApiModelRawSchema.parse({
        id: 'recraft/recraft-v4-pro',
        type: 'image',
        owned_by: 'recraft',
        tags: [IMAGE_GENERATION_TAG],
      }).owned_by
    ).toBe('recraft');
  });
});

describe('llmProviderSchema', () => {
  const validProvider = {
    type: LLMProviderType.OPENAI,
    name: 'custom-provider',
    models: 'gpt-4o,gpt-4o-mini',
  };

  it('accepts a provider whose name and models contain no @', () => {
    expect(llmProviderSchema.safeParse(validProvider).success).toBe(true);
  });

  it("rejects a provider name containing '@' (reserved model key delimiter)", () => {
    const result = llmProviderSchema.safeParse({ ...validProvider, name: 'team@corp' });
    expect(result.success).toBe(false);
  });

  it("rejects a models list containing '@' (reserved model key delimiter)", () => {
    const result = llmProviderSchema.safeParse({
      ...validProvider,
      models: 'gpt-4o,gemini-1.0-pro-001@vertex',
    });
    expect(result.success).toBe(false);
  });

  it('accepts the MiniMax provider preset', () => {
    expect(
      llmProviderSchema.safeParse({
        type: LLMProviderType.MINIMAX,
        name: 'minimax',
        baseUrl: MINIMAX_PROVIDER_ENDPOINTS[0].baseUrl,
        models: MINIMAX_MODEL_IDS.join(','),
        modelConfigs: MINIMAX_DEFAULT_MODEL_CONFIGS,
      }).success
    ).toBe(true);
  });
});

describe('MiniMax provider preset', () => {
  it('contains regional chat and messages endpoints', () => {
    expect(MINIMAX_PROVIDER_ENDPOINTS).toEqual([
      {
        region: 'global_en',
        apiStyle: 'chatCompletions',
        baseUrl: 'https://api.minimax.io/v1',
      },
      {
        region: 'cn_zh',
        apiStyle: 'chatCompletions',
        baseUrl: 'https://api.minimaxi.com/v1',
      },
      {
        region: 'global_en',
        apiStyle: 'messages',
        baseUrl: 'https://api.minimax.io/anthropic',
      },
      {
        region: 'cn_zh',
        apiStyle: 'messages',
        baseUrl: 'https://api.minimaxi.com/anthropic',
      },
    ]);
    expect(isMiniMaxMessagesEndpoint('https://api.minimax.io/anthropic/')).toBe(true);
    expect(isMiniMaxMessagesEndpoint('https://api.minimax.io/v1')).toBe(false);
  });

  it('contains the current text model metadata', () => {
    expect(MINIMAX_MODEL_IDS).toEqual(['MiniMax-M3', 'MiniMax-M2.7']);
    expect(MINIMAX_DEFAULT_MODEL_CONFIGS['MiniMax-M3']).toMatchObject({
      contextWindow: 1_000_000,
      pricing: {
        input: '0.0000006',
        output: '0.0000024',
        inputCacheRead: '0.00000012',
      },
      ability: { image: true, reasoning: true },
    });
    expect(MINIMAX_DEFAULT_MODEL_CONFIGS['MiniMax-M2.7']).toMatchObject({
      contextWindow: 204_800,
      pricing: {
        input: '0.0000003',
        output: '0.0000012',
        inputCacheRead: '0.00000006',
        inputCacheWrite: '0.000000375',
      },
      ability: { reasoning: true },
    });
  });
});

describe('modelKeySchema', () => {
  it("accepts a well-formed 'type@model@name' key and an empty string", () => {
    expect(modelKeySchema.safeParse('aiGateway@anthropic/claude-sonnet-4@teable').success).toBe(
      true
    );
    expect(modelKeySchema.safeParse('').success).toBe(true);
  });

  it("rejects a key with extra segments from a model id containing '@'", () => {
    // parseModelKey would silently truncate this to 'custom/image-model'.
    expect(modelKeySchema.safeParse('aiGateway@custom/image-model@beta@teable').success).toBe(
      false
    );
  });

  it('rejects a key with too few segments', () => {
    expect(modelKeySchema.safeParse('gpt-4o').success).toBe(false);
  });

  it('rejects a key with empty segments', () => {
    expect(modelKeySchema.safeParse('openai@@teable').success).toBe(false);
    expect(modelKeySchema.safeParse('@@').success).toBe(false);
    expect(modelKeySchema.safeParse('@gpt-4o@teable').success).toBe(false);
  });
});
