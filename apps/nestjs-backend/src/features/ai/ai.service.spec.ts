/* eslint-disable @typescript-eslint/naming-convention */
import { LLMProviderType } from '@teable/openapi';
import type { LLMProvider } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';

const openAIProviderName = 'custom-openai';
const openRouterProviderName = 'custom-openrouter';
const gptImage2Model = 'gpt-image-2';
const openRouterModel = `openai/${gptImage2Model}`;
const imageGenerationTag = 'image-generation';

const setBaseConfig = (service: AiService, isCloud: boolean) => {
  (service as unknown as { baseConfig: { isCloud: boolean } }).baseConfig = { isCloud };
};

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
  const service = Object.create(AiService.prototype) as AiService;
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
    setBaseConfig(service, true);

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
    setBaseConfig(service, false);

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
    setBaseConfig(service, true);

    expect(() =>
      service.resolveModelMapping(sourceModelKey, [{ ...providers[0], modelConfigs: undefined }], {
        llmProviders: providers,
        modelMappings: [{ sourceModelKey, targetModelKey, enabled: true }],
      })
    ).toThrow('AI model mapping target pricing is not configured');
  });
});

describe('AiService.isInstanceAIModelByConfig', () => {
  const service = Object.create(AiService.prototype) as AiService;

  it('treats gateway models as instance models', () => {
    expect(
      service.isInstanceAIModelByConfig(
        `${LLMProviderType.AI_GATEWAY}@anthropic/claude-sonnet-4@teable`,
        []
      )
    ).toBe(true);
  });

  it('uses provider config before the @teable suffix', () => {
    expect(
      service.isInstanceAIModelByConfig(`${LLMProviderType.OPENAI}@gpt-5.5@teable`, [
        {
          type: LLMProviderType.OPENAI,
          name: 'teable',
          models: 'gpt-5.5',
        },
      ])
    ).toBe(false);
  });

  it('detects admin custom providers from provider config', () => {
    expect(
      service.isInstanceAIModelByConfig(`${LLMProviderType.OPENAI}@gpt-5.5@teable`, [
        {
          type: LLMProviderType.OPENAI,
          name: 'teable',
          models: 'gpt-5.5',
          isInstance: true,
        },
      ])
    ).toBe(true);
  });

  it('treats generated BYOK provider names as space-level models', () => {
    expect(
      service.isInstanceAIModelByConfig(`${LLMProviderType.OPENAI}@gpt-5.5@byok-a7k2`, [
        {
          type: LLMProviderType.OPENAI,
          name: 'byok-a7k2',
          models: 'gpt-5.5',
        },
      ])
    ).toBe(false);
  });

  it('falls back to legacy @teable detection when provider config is unavailable', () => {
    expect(service.isInstanceAIModelByConfig(`${LLMProviderType.OPENAI}@gpt-5.5@teable`, [])).toBe(
      true
    );
  });
});

describe('AiService space model resolution', () => {
  const spaceModelKey = `${LLMProviderType.OPENAI}@space-model@space-provider`;
  const instanceModelKey = `${LLMProviderType.ANTHROPIC}@instance-model@teable`;
  const spaceProvider: LLMProvider = {
    type: LLMProviderType.OPENAI,
    name: 'space-provider',
    models: 'space-model',
    apiKey: 'space-key',
    baseUrl: 'https://space.example.com',
  };
  const instanceProvider: LLMProvider = {
    type: LLMProviderType.ANTHROPIC,
    name: 'teable',
    models: 'instance-model',
    apiKey: 'instance-key',
    baseUrl: 'https://instance.example.com',
  };

  const createConfigService = (
    spaceConfig: Record<string, unknown>,
    instanceConfig?: Record<string, unknown>
  ) => {
    const service = Object.create(AiService.prototype) as AiService;
    setBaseConfig(service, false);
    (service as unknown as { prismaService: unknown }).prismaService = {
      integration: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'int-space', config: JSON.stringify(spaceConfig) }),
      },
    };
    (service as unknown as { settingService: unknown }).settingService = {
      getSetting: vi.fn().mockResolvedValue({ aiConfig: instanceConfig }),
    };
    vi.spyOn(service, 'getModelTags').mockResolvedValue([]);
    return service;
  };

  it.each([
    { name: 'Admin AI config is missing', config: undefined },
    { name: 'Admin providers are empty', config: { llmProviders: [] } },
    {
      name: 'Admin provider was deleted',
      config: {
        llmProviders: [],
        chatModel: { lg: instanceModelKey, sm: instanceModelKey, md: instanceModelKey },
      },
    },
    {
      name: 'Admin model was removed from its provider',
      config: {
        llmProviders: [{ ...instanceProvider, models: 'another-model' }],
        chatModel: { lg: instanceModelKey },
      },
    },
    {
      name: 'Admin lg was cleared but other tiers remain',
      config: {
        llmProviders: [],
        chatModel: { sm: instanceModelKey, md: instanceModelKey, ability: { toolCall: true } },
      },
    },
  ])('uses the Space model for every tier when $name', async ({ config: instanceConfig }) => {
    const service = createConfigService({ llmProviders: [spaceProvider] }, instanceConfig);

    const config = await service.getAIConfigBySpaceId('spc-test');

    expect(config.chatModel).toEqual({
      lg: spaceModelKey,
      md: spaceModelKey,
      sm: spaceModelKey,
    });

    const resolved = await service.getChatModelInstanceBySpaceId('spc-test');

    expect(resolved).toMatchObject({
      lg: { modelId: 'space-model' },
      md: { modelId: 'space-model' },
      sm: { modelId: 'space-model' },
      isInstance: false,
      lgModelKey: spaceModelKey,
      mdModelKey: spaceModelKey,
      smModelKey: spaceModelKey,
    });
  });

  it('keeps the Admin default when Space providers and legacy chatModel data exist', async () => {
    const service = createConfigService(
      { llmProviders: [spaceProvider], chatModel: { lg: spaceModelKey } },
      {
        llmProviders: [instanceProvider],
        chatModel: { lg: instanceModelKey, ability: { toolCall: true } },
        gatewayModels: [{ id: 'anthropic/instance-model', enabled: true }],
      }
    );

    const config = await service.getAIConfigBySpaceId('spc-test');

    expect(config.chatModel?.lg).toBe(instanceModelKey);
    expect(config.chatModel?.sm).toBe(instanceModelKey);
    expect(config.chatModel?.md).toBe(instanceModelKey);
    expect(config.chatModel?.ability).toEqual({ toolCall: true });
    expect(config.llmProviders).toEqual([spaceProvider, { ...instanceProvider, isInstance: true }]);
    expect(config.gatewayModels).toEqual([{ id: 'anthropic/instance-model', enabled: true }]);
  });

  it('keeps the Admin Gateway default without requiring a custom provider entry', async () => {
    const gatewayModelKey = `${LLMProviderType.AI_GATEWAY}@openai/gpt-4o@teable`;
    const service = createConfigService(
      { llmProviders: [spaceProvider] },
      { chatModel: { lg: gatewayModelKey }, aiGatewayApiKey: 'gateway-test-key' }
    );

    const config = await service.getAIConfigBySpaceId('spc-test');

    expect(config.chatModel).toMatchObject({
      lg: gatewayModelKey,
      md: gatewayModelKey,
      sm: gatewayModelKey,
    });
  });

  it('uses the existing configuration error when neither level has a model', async () => {
    const service = createConfigService({ llmProviders: [] });

    await expect(service.getChatModelInstanceBySpaceId('spc-test')).rejects.toThrow(
      'AI chat model lg is not set'
    );
  });
});

describe('AiService.getSimplifiedAIConfig', () => {
  const spaceProvider = {
    type: LLMProviderType.OPENAI,
    name: 'space-provider',
    models: 'space-model',
    isInstance: false,
  };
  const instanceProvider = {
    type: LLMProviderType.ANTHROPIC,
    name: 'teable',
    models: 'claude-sonnet-4-6',
    isInstance: true,
    modelConfigs: {
      'claude-sonnet-4-6': {
        ability: {
          image: { url: false, base64: true },
          pdf: { url: false, base64: true },
          toolCall: true,
        },
      },
    },
  };

  const createService = (isCloud: boolean) => {
    const service = Object.create(AiService.prototype) as AiService;
    setBaseConfig(service, isCloud);
    vi.spyOn(service, 'getAIConfig').mockResolvedValue({
      enable: true,
      llmProviders: [spaceProvider, instanceProvider],
      chatModel: {
        lg: `${LLMProviderType.AI_GATEWAY}@anthropic/claude-sonnet-4@teable`,
      },
      embeddingModel: `${LLMProviderType.OPENAI}@text-embedding-3-small@space-provider`,
      translationModel: `${LLMProviderType.OPENAI}@gpt-4.1-mini@space-provider`,
      capabilities: { disableActions: [] },
      gatewayModels: [{ id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', enabled: true }],
      attachmentTransferMode: 'base64',
      aiGatewayApiKey: 'secret-key',
      aiGatewayApiKeys: ['secret-key-2'],
      vertexByokCredential: {
        project: 'project',
        location: 'us-central1',
        googleCredentials: {
          privateKey: 'private-key',
          clientEmail: 'client@example.com',
        },
      },
    } as Awaited<ReturnType<AiService['getAIConfig']>>);
    return service;
  };

  it('omits instance providers and secret config from cloud user config', async () => {
    const config = await createService(true).getSimplifiedAIConfig('base-id');

    expect(config?.llmProviders).toEqual([spaceProvider]);
    expect(config?.embeddingModel).toBe(
      `${LLMProviderType.OPENAI}@text-embedding-3-small@space-provider`
    );
    expect(config?.translationModel).toBe(`${LLMProviderType.OPENAI}@gpt-4.1-mini@space-provider`);
    expect(config?.attachmentTransferMode).toBe('base64');
    expect(config).not.toHaveProperty('aiGatewayApiKey');
    expect(config).not.toHaveProperty('aiGatewayApiKeys');
    expect(config).not.toHaveProperty('vertexByokCredential');
  });

  it('keeps instance providers outside cloud', async () => {
    const config = await createService(false).getSimplifiedAIConfig('base-id');

    expect(config?.llmProviders).toEqual([spaceProvider, instanceProvider]);
  });
});
