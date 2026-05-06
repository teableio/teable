import type { LLMProvider } from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { normalizeLLMProviderModelConfigs } from './utils';

describe('normalizeLLMProviderModelConfigs', () => {
  it('removes stale hidden configs and backfills known OpenAI image abilities', () => {
    const provider: LLMProvider = {
      type: LLMProviderType.OPENAI,
      name: 'teable',
      apiKey: 'test',
      models: 'gpt-image-1,gpt-image-1.5,gpt-image-2',
      modelConfigs: {
        'gpt-5.4': {
          ability: {
            image: true,
          },
          testedAt: 1,
        },
        'gpt-image-1': {
          isImageModel: true,
          testedAt: 2,
        },
        'gpt-image-1.5': {
          isImageModel: true,
          testedAt: 3,
        },
        'gpt-image-2': {
          isImageModel: true,
          imageAbility: {
            generation: true,
            imageToImage: true,
          },
          tags: ['image-generation', 'vision'],
          testedAt: 4,
        },
      },
    };

    const normalized = normalizeLLMProviderModelConfigs(provider);

    expect(Object.keys(normalized.modelConfigs ?? {})).toEqual([
      'gpt-image-1',
      'gpt-image-1.5',
      'gpt-image-2',
    ]);
    expect(normalized.modelConfigs?.['gpt-image-1']?.imageAbility).toEqual({
      generation: true,
      imageToImage: true,
    });
    expect(normalized.modelConfigs?.['gpt-image-1']?.modelType).toBe('image');
    expect(normalized.modelConfigs?.['gpt-image-1']?.tags).toEqual(['image-generation', 'vision']);
    expect(normalized.modelConfigs?.['gpt-image-1.5']?.imageAbility).toEqual({
      generation: true,
      imageToImage: true,
    });
  });

  it('does not infer image ability for OpenAI-compatible custom providers', () => {
    const provider: LLMProvider = {
      type: LLMProviderType.OPENAI_COMPATIBLE,
      name: 'custom',
      apiKey: 'test',
      models: 'gpt-image-2',
      modelConfigs: {
        'gpt-image-2': {
          isImageModel: true,
        },
      },
    };

    const normalized = normalizeLLMProviderModelConfigs(provider);

    expect(normalized.modelConfigs?.['gpt-image-2']?.imageAbility).toBeUndefined();
    expect(normalized.modelConfigs?.['gpt-image-2']?.tags).toBeUndefined();
  });

  it('cleans image ability tags when a model is no longer marked as an image model', () => {
    const provider: LLMProvider = {
      type: LLMProviderType.OPENAI,
      name: 'teable',
      apiKey: 'test',
      models: 'gpt-image-2',
      modelConfigs: {
        'gpt-image-2': {
          isImageModel: false,
          modelType: 'image',
          imageAbility: {
            generation: true,
            imageToImage: true,
          },
          tags: ['image-generation', 'vision', 'tool-use'],
        },
      },
    };

    const normalized = normalizeLLMProviderModelConfigs(provider);

    expect(normalized.modelConfigs?.['gpt-image-2']?.imageAbility).toBeUndefined();
    expect(normalized.modelConfigs?.['gpt-image-2']?.modelType).toBeUndefined();
    expect(normalized.modelConfigs?.['gpt-image-2']?.tags).toEqual(['vision', 'tool-use']);
  });

  it('backfills model type for known Google image-generation language models', () => {
    const provider: LLMProvider = {
      type: LLMProviderType.GOOGLE,
      name: 'google',
      apiKey: 'test',
      models: 'gemini-3-pro-image',
      modelConfigs: {
        'gemini-3-pro-image': {
          isImageModel: true,
        },
      },
    };

    const normalized = normalizeLLMProviderModelConfigs(provider);

    expect(normalized.modelConfigs?.['gemini-3-pro-image']?.modelType).toBe('language');
    expect(normalized.modelConfigs?.['gemini-3-pro-image']?.imageAbility).toEqual({
      generation: true,
      imageToImage: true,
    });
    expect(normalized.modelConfigs?.['gemini-3-pro-image']?.tags).toEqual([
      'image-generation',
      'vision',
    ]);
  });
});
