/* eslint-disable @typescript-eslint/naming-convention */
import { LLMProviderType } from '@teable/openapi';
import type { LLMProvider } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { AiService } from './ai.service';

const openAIProviderName = 'custom-openai';
const openRouterProviderName = 'custom-openrouter';
const gptImage2Model = 'gpt-image-2';
const openRouterModel = `openai/${gptImage2Model}`;
const imageGenerationTag = 'image-generation';

describe('AiService.getModelTags', () => {
  const service = Object.create(AiService.prototype) as AiService;

  it('does not infer tags for direct OpenAI GPT image models without explicit config', async () => {
    const tags = await service.getModelTags(
      `${LLMProviderType.OPENAI}@${gptImage2Model}@${openAIProviderName}`,
      [
        {
          type: LLMProviderType.OPENAI,
          name: openAIProviderName,
          models: gptImage2Model,
        },
      ]
    );

    expect(tags).toEqual([]);
  });

  it('returns explicit direct OpenAI GPT image tags without inference', async () => {
    const tags = await service.getModelTags(
      `${LLMProviderType.OPENAI}@${gptImage2Model}@${openAIProviderName}`,
      [
        {
          type: LLMProviderType.OPENAI,
          name: openAIProviderName,
          models: gptImage2Model,
          modelConfigs: {
            [gptImage2Model]: {
              tags: [imageGenerationTag],
            },
          },
        },
      ]
    );

    expect(tags).toEqual([imageGenerationTag]);
  });

  it('does not infer tags for OpenRouter models without explicit config', async () => {
    const tags = await service.getModelTags(
      `${LLMProviderType.OPENROUTER}@${openRouterModel}@${openRouterProviderName}`,
      [
        {
          type: LLMProviderType.OPENROUTER,
          name: openRouterProviderName,
          models: openRouterModel,
        },
      ]
    );

    expect(tags).toEqual([]);
  });
});

describe('AiService model mappings', () => {
  const service = Object.create(AiService.prototype) as AiService & {
    baseConfig: { isCloud: boolean };
  };
  const sourceModelKey = `${LLMProviderType.AI_GATEWAY}@anthropic/claude-sonnet-4@teable`;
  const targetModelKey = `${LLMProviderType.OPENAI}@gpt-4.1@teable`;
  const providers: LLMProvider[] = [
    {
      type: LLMProviderType.OPENAI,
      name: 'teable',
      models: 'gpt-4.1',
      isInstance: true,
      modelConfigs: {
        'gpt-4.1': {
          inputRate: 100,
          outputRate: 200,
        },
      },
    },
  ];

  it('resolves enabled gateway mapping to instance custom provider in cloud', () => {
    service.baseConfig = { isCloud: true };

    expect(
      service.resolveModelMapping(sourceModelKey, providers, {
        llmProviders: providers,
        modelMappings: [{ sourceModelKey, targetModelKey, enabled: true }],
      })
    ).toEqual({
      requestedModelKey: sourceModelKey,
      effectiveModelKey: targetModelKey,
      mapped: true,
    });
  });

  it('does not apply model mappings outside cloud', () => {
    service.baseConfig = { isCloud: false };

    expect(
      service.resolveModelMapping(sourceModelKey, providers, {
        llmProviders: providers,
        modelMappings: [{ sourceModelKey, targetModelKey, enabled: true }],
      })
    ).toEqual({
      requestedModelKey: sourceModelKey,
      effectiveModelKey: sourceModelKey,
      mapped: false,
    });
  });

  it('rejects mapped targets without pricing config', () => {
    service.baseConfig = { isCloud: true };

    expect(() =>
      service.resolveModelMapping(sourceModelKey, [{ ...providers[0], modelConfigs: undefined }], {
        llmProviders: providers,
        modelMappings: [{ sourceModelKey, targetModelKey, enabled: true }],
      })
    ).toThrow('AI model mapping target pricing is not configured');
  });
});
