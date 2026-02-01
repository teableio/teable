/* eslint-disable sonarjs/no-duplicate-string */
import type { OpenAIProvider } from '@ai-sdk/openai';
import { Injectable, Logger } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  IntegrationType,
  LLMProviderType,
  SettingKey,
  Task,
  convertGatewayApiModel,
} from '@teable/openapi';
import type {
  IAIConfig,
  IAiGenerateRo,
  IChatModelAbility,
  IGatewayApiModel,
  IGatewayApiModelRaw,
  IGetAIConfig,
  GatewayModelTag,
  LLMProvider,
} from '@teable/openapi';
import type { ImageModel, LanguageModel } from 'ai';
import { createGateway, generateText, streamText } from 'ai';
import axios from 'axios';
import type { Response } from 'express';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { CustomHttpException } from '../../custom.exception';
import { PerformanceCacheService } from '../../performance-cache';
import { SettingService } from '../setting/setting.service';
import { getAdaptedProviderOptions, getTaskModelKey, modelProviders } from './util';

// Fixed name for AI Gateway provider in modelKey (format: aiGateway@<modelId>@teable)
export const AI_GATEWAY_PROVIDER_NAME = 'teable';

export type ILanguageModelV2 = Exclude<LanguageModel, string>;

// In-memory cache for Gateway models (TTL: 10 minutes)
const gatewayModelsCacheTtl = 10 * 60 * 1000;

interface IGatewayModelsCache {
  data: IGatewayApiModel[];
  expiresAt: number;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  // In-memory cache for Gateway models API - faster than Redis for static data
  private gatewayModelsCache: IGatewayModelsCache | null = null;

  constructor(
    private readonly settingService: SettingService,
    private readonly prismaService: PrismaService,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  public parseModelKey(modelKey: string) {
    const [type, model, name] = modelKey.split('@');
    return { type, model, name };
  }

  /**
   * Check if modelKey is an AI Gateway model
   * Format: aiGateway@<modelId>@teable
   */
  public isGatewayModel(modelKey: string): boolean {
    const { type, name } = this.parseModelKey(modelKey);
    return (
      type?.toLowerCase() === LLMProviderType.AI_GATEWAY.toLowerCase() &&
      name?.toLowerCase() === AI_GATEWAY_PROVIDER_NAME.toLowerCase()
    );
  }

  /**
   * Build a gateway modelKey from a gateway model ID
   * @param modelId Gateway model ID (e.g., "anthropic/claude-sonnet-4")
   */
  public buildGatewayModelKey(modelId: string): string {
    return `${LLMProviderType.AI_GATEWAY}@${modelId}@${AI_GATEWAY_PROVIDER_NAME}`;
  }

  /**
   * Parse owner/provider from gateway model ID
   * @param modelId Gateway model ID (e.g., "anthropic/claude-sonnet-4" -> "anthropic")
   */
  private parseOwnerFromModelId(modelId: string): string | undefined {
    const parts = modelId.split('/');
    return parts.length > 1 ? parts[0].toLowerCase() : undefined;
  }

  // modelKey-> type@model@name
  async getModelConfig(modelKey: string, llmProviders: LLMProvider[] = []) {
    const { type, model, name } = this.parseModelKey(modelKey);

    // Special handling for AI Gateway models
    if (this.isGatewayModel(modelKey)) {
      const { aiConfig } = await this.settingService.getSetting([SettingKey.AI_CONFIG]);

      if (!aiConfig?.aiGatewayApiKey) {
        throw new CustomHttpException(
          'AI Gateway API key is not configured',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.ai.gatewayApiKeyNotSet',
            },
          }
        );
      }

      return {
        type: LLMProviderType.AI_GATEWAY,
        model, // This is the gateway modelId (e.g., "anthropic/claude-sonnet-4")
        baseUrl: aiConfig.aiGatewayBaseUrl || undefined,
        apiKey: aiConfig.aiGatewayApiKey,
      };
    }

    // Standard provider lookup
    const providerConfig = llmProviders.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() && p.type.toLowerCase() === type.toLowerCase()
    );

    if (!providerConfig) {
      throw new CustomHttpException(
        'AI provider configuration is not set',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.ai.providerConfigurationNotSet',
          },
        }
      );
    }

    const { baseUrl, apiKey } = providerConfig;

    return {
      type,
      model,
      baseUrl,
      apiKey,
    };
  }

  async getModelInstance(
    modelKey: string,
    llmProviders: LLMProvider[],
    isImageGeneration: true
  ): Promise<ReturnType<OpenAIProvider['image']>>;
  async getModelInstance(
    modelKey: string,
    llmProviders?: LLMProvider[],
    isImageGeneration?: false
  ): Promise<ILanguageModelV2>;
  async getModelInstance(
    modelKey: string,
    llmProviders: LLMProvider[] = [],
    isImageGeneration = false
  ): Promise<ILanguageModelV2 | ImageModel> {
    const { type, model, baseUrl, apiKey } = await this.getModelConfig(modelKey, llmProviders);

    // For AI Gateway models, use official gateway provider from AI SDK
    // See: https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway
    // baseUrl is optional - SDK uses its default if not provided
    if (type === LLMProviderType.AI_GATEWAY) {
      if (!apiKey) {
        throw new CustomHttpException(
          'AI configuration is not set',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.ai.configurationNotSet',
            },
          }
        );
      }
      const gatewayProvider = createGateway({
        apiKey,
        ...(baseUrl && { baseURL: baseUrl }),
      });
      // Return appropriate model type based on isImageGeneration flag
      // Image models (e.g., bfl/flux-pro) use gatewayProvider.imageModel()
      // Language models (including Gemini image via generateText) use gatewayProvider()
      return isImageGeneration ? gatewayProvider.imageModel(model) : gatewayProvider(model);
    }

    // For standard providers, both baseUrl and apiKey are required
    if (!baseUrl || !apiKey) {
      throw new CustomHttpException('AI configuration is not set', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.ai.configurationNotSet',
        },
      });
    }

    const effectiveType = type;
    const effectiveModel = model;

    const provider = Object.entries(modelProviders).find(
      ([key]) => effectiveType.toLowerCase() === key.toLowerCase()
    )?.[1];

    if (!provider) {
      throw new CustomHttpException(
        `Unsupported AI provider: ${effectiveType}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.ai.unsupportedProvider',
            context: {
              type: effectiveType,
            },
          },
        }
      );
    }

    const providerOptions = getAdaptedProviderOptions(effectiveType as LLMProviderType, {
      name: effectiveModel,
      baseURL: baseUrl,
      apiKey,
    });
    const modelProvider = provider(providerOptions as never) as OpenAIProvider;

    return isImageGeneration
      ? (modelProvider.image(effectiveModel) as ReturnType<OpenAIProvider['image']>)
      : modelProvider(effectiveModel);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async getAIConfig(baseId: string) {
    const { spaceId } = await this.prismaService.base.findUniqueOrThrow({
      where: { id: baseId },
    });
    const aiIntegration = await this.prismaService.integration.findFirst({
      where: { resourceId: spaceId, type: IntegrationType.AI, enable: true },
    });

    const aiIntegrationConfig = aiIntegration?.config ? JSON.parse(aiIntegration.config) : null;
    const { aiConfig } = await this.settingService.getSetting();

    if (!aiIntegrationConfig && (!aiConfig || !aiConfig.enable)) {
      throw new CustomHttpException('AI configuration is not set', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.ai.configurationNotSet',
        },
      });
    }

    let config: IAIConfig;

    if (!aiIntegrationConfig) {
      const lg = aiConfig?.chatModel?.lg;
      const sm = aiConfig?.chatModel?.sm;
      const md = aiConfig?.chatModel?.md;
      const ability = aiConfig?.chatModel?.ability;

      config = {
        ...aiConfig,
        llmProviders: aiConfig?.llmProviders.map((provider) => ({
          ...provider,
          isInstance: true,
        })),
        chatModel: {
          sm: sm || lg,
          md: md || lg,
          lg: lg,
          ability,
        },
      } as IAIConfig;
    } else if (!aiConfig?.enable) {
      config = aiIntegrationConfig as IAIConfig;
    } else {
      const lg = aiIntegrationConfig.chatModel?.lg;
      const sm = aiIntegrationConfig.chatModel?.sm;
      const md = aiIntegrationConfig.chatModel?.md;
      const ability = aiIntegrationConfig.chatModel?.ability;
      config = {
        ...aiIntegrationConfig,
        // Include gateway models from admin config (space config doesn't have gateway models)
        gatewayModels: aiConfig.gatewayModels,
        llmProviders: [
          ...aiIntegrationConfig.llmProviders,
          ...aiConfig.llmProviders.map((provider) => ({
            ...provider,
            isInstance: true,
          })),
        ],
        chatModel: {
          sm: sm || lg,
          md: md || lg,
          lg: lg,
          ability,
        },
      } as IAIConfig;
    }

    // Fetch tags for the lg chat model and include in response
    const lgModelKey = config.chatModel?.lg;
    if (lgModelKey) {
      try {
        const tags = await this.getModelTags(lgModelKey, config.llmProviders);
        if (tags.length > 0) {
          // Add tags to chatModel response (IGetAIConfig extends IAIConfig with tags)
          return {
            ...config,
            chatModel: {
              ...config.chatModel,
              tags,
            },
          } as IGetAIConfig;
        }
      } catch (error) {
        this.logger.warn(`[getAIConfig] Failed to get tags for chat model ${lgModelKey}: ${error}`);
      }
    }

    return config as IGetAIConfig;
  }

  async getAIDisableAIActions(baseId: string) {
    const { spaceId } = await this.prismaService.base.findUniqueOrThrow({
      where: { id: baseId },
      select: { spaceId: true },
    });
    // get space ai setting
    const aiIntegration = await this.prismaService.integration.findUnique({
      where: { resourceId: spaceId, type: IntegrationType.AI },
    });

    const aiIntegrationConfig = aiIntegration?.config ? JSON.parse(aiIntegration.config) : null;
    const disableAIActionsFromSpaceIntegration = aiIntegrationConfig?.capabilities?.disableActions;

    // get instance ai setting
    const { aiConfig } = await this.settingService.getSetting();
    const disableAIActionsFromInstanceAiSetting = aiConfig?.capabilities?.disableActions;

    return {
      disableActions:
        disableAIActionsFromSpaceIntegration || disableAIActionsFromInstanceAiSetting || [],
    };
  }

  async getToolApiKeys(baseId: string) {
    const { appConfig } = await this.settingService.getSetting([SettingKey.APP_CONFIG]);
    const { spaceId } = await this.prismaService.base.findUniqueOrThrow({
      where: { id: baseId },
    });
    const aiIntegration = await this.prismaService.integration.findFirst({
      where: { resourceId: spaceId, type: IntegrationType.AI },
    });
    const aiIntegrationConfig = aiIntegration?.config ? JSON.parse(aiIntegration.config) : null;
    return {
      v0ApiKey: aiIntegrationConfig?.appConfig?.apiKey || appConfig?.apiKey,
    };
  }

  async getSimplifiedAIConfig(baseId: string) {
    try {
      const config = await this.getAIConfig(baseId);
      return {
        ...config,
        llmProviders: config.llmProviders.map(
          ({ type, name, models, isInstance, modelConfigs }) => ({
            type,
            name,
            models,
            isInstance,
            modelConfigs,
          })
        ),
      };
    } catch {
      return null;
    }
  }

  private async getGenerationModelInstance(baseId: string, aiGenerateRo: IAiGenerateRo) {
    const { modelKey: _modelKey, task = Task.Coding } = aiGenerateRo;
    const config = await this.getAIConfig(baseId);
    const modelKey = _modelKey ?? getTaskModelKey(config, task);
    if (!modelKey) {
      throw new Error('Model key is not set');
    }
    return await this.getModelInstance(modelKey, config.llmProviders);
  }

  async generateStream(
    baseId: string,
    aiGenerateRo: IAiGenerateRo,
    response: Response
  ): Promise<void> {
    const { prompt } = aiGenerateRo;
    const modelInstance = await this.getGenerationModelInstance(baseId, aiGenerateRo);

    const result = streamText({
      model: modelInstance,
      prompt: prompt,
    });

    result.pipeTextStreamToResponse(response);
  }

  async generateText(baseId: string, aiGenerateRo: IAiGenerateRo) {
    const { prompt } = aiGenerateRo;
    const modelInstance = await this.getGenerationModelInstance(baseId, aiGenerateRo);

    const { text } = await generateText({
      model: modelInstance,
      prompt: prompt,
    });
    return text;
  }

  async getInstanceAIConfig() {
    if (!this.baseConfig.isCloud) return null;

    const { aiConfig } = await this.settingService.getSetting();

    if (!aiConfig?.enable) return null;

    return aiConfig;
  }

  findModelInProviders(modelKey: string, llmProviders: LLMProvider[]): boolean {
    const { type, model, name } = this.parseModelKey(modelKey);

    const providerConfig = llmProviders.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() &&
        p.type.toLowerCase() === type.toLowerCase() &&
        p.models.includes(model)
    );
    return !!providerConfig;
  }

  /**
   * Check if a gateway model should be billed
   * All AI Gateway models should be billed as long as aiGatewayApiKey is configured
   * The gatewayModels list is just for recommended/displayed models, not a billing whitelist
   */
  async findModelInGateway(modelKey: string): Promise<boolean> {
    if (!this.isGatewayModel(modelKey)) {
      this.logger.debug(`[findModelInGateway] ${modelKey} is not a gateway model`);
      return false;
    }

    const { model: modelId } = this.parseModelKey(modelKey);
    const { aiConfig } = await this.settingService.getSetting([SettingKey.AI_CONFIG]);

    // Check if gateway is configured - if yes, all gateway models should be billed
    if (!aiConfig?.aiGatewayApiKey) {
      this.logger.warn(
        `[findModelInGateway] No aiGatewayApiKey configured, model ${modelId} will not be billed`
      );
      return false;
    }

    this.logger.debug(
      `[findModelInGateway] AI Gateway configured, model ${modelId} will be billed`
    );
    return true;
  }

  async checkInstanceAIModel(modelKey: string): Promise<boolean> {
    // Check gateway models first
    if (this.isGatewayModel(modelKey)) {
      return this.findModelInGateway(modelKey);
    }

    const aiConfig = await this.getInstanceAIConfig();
    if (!aiConfig) return false;

    return this.findModelInProviders(modelKey, aiConfig.llmProviders);
  }

  async getChatModelInstance(baseId: string) {
    const { chatModel, llmProviders } = await this.getAIConfig(baseId);
    if (!chatModel?.lg) {
      throw new CustomHttpException('AI chat model lg is not set', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.ai.chatModelLgNotSet',
        },
      });
    }

    // Check if lg model is a gateway model
    const isGateway = this.isGatewayModel(chatModel.lg);
    let isInstance = false;

    if (isGateway) {
      // Gateway models are instance-level (from admin config)
      isInstance = true;
    } else {
      // Standard provider lookup
      const { type, model, name } = this.parseModelKey(chatModel?.lg);
      const lgProvider = llmProviders.find(
        (p) =>
          p.name.toLowerCase() === name.toLowerCase() &&
          p.type.toLowerCase() === type.toLowerCase() &&
          p.models.includes(model)
      );
      if (!lgProvider) {
        throw new CustomHttpException(
          'AI chat model lg provider is not set',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.ai.chatModelLgProviderNotSet',
            },
          }
        );
      }
      isInstance = !!lgProvider.isInstance;
    }

    if (!chatModel?.sm) {
      throw new CustomHttpException('AI chat model sm is not set', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.ai.chatModelSmNotSet',
        },
      });
    }
    if (!chatModel?.md) {
      throw new CustomHttpException('AI chat model md is not set', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.ai.chatModelMdNotSet',
        },
      });
    }

    return {
      sm: await this.getModelInstance(chatModel?.sm, llmProviders),
      md: await this.getModelInstance(chatModel?.md, llmProviders),
      lg: await this.getModelInstance(chatModel?.lg, llmProviders),
      ability: chatModel?.ability,
      isInstance,
      lgModelKey: chatModel.lg,
    };
  }

  /**
   * Get gateway model configuration by modelId
   * First checks local gatewayModels config, then falls back to API
   */
  async getGatewayModelConfig(modelId: string) {
    // First check local config (admin-configured models)
    const { aiConfig } = await this.settingService.getSetting([SettingKey.AI_CONFIG]);
    const gatewayModels = aiConfig?.gatewayModels ?? [];
    const localModel = gatewayModels.find((m) => m.id === modelId);
    if (localModel) {
      return localModel;
    }

    // If not found locally, fetch from API (for custom-selected models)
    const apiModel = await this.getGatewayApiModel(modelId);
    if (apiModel) {
      // Convert API model format to local model format
      return {
        ...apiModel,
        label: apiModel.name || apiModel.id,
        enabled: true,
      };
    }

    return undefined;
  }

  /**
   * Get model capability tags for any model (AI Gateway or custom provider)
   * This is the unified method to determine model capabilities like vision, file-input, etc.
   *
   * Priority:
   * 1. AI Gateway: from getGatewayModelConfig().tags
   * 2. Custom Provider: from modelConfigs[model].tags
   * 3. Fallback: convert deprecated ability field to tags (backward compatibility)
   *
   * @param modelKey - Model key in format: type@model@name
   * @param llmProviders - List of configured LLM providers (required for custom providers)
   */
  async getModelTags(modelKey: string, llmProviders: LLMProvider[]): Promise<GatewayModelTag[]> {
    const { type, model, name } = this.parseModelKey(modelKey);

    // AI Gateway models: get tags from gateway config
    if (type === LLMProviderType.AI_GATEWAY) {
      try {
        const gatewayModel = await this.getGatewayModelConfig(model);
        if (gatewayModel?.tags?.length) {
          const tags = [...gatewayModel.tags];
          // Patch: Google models with image-generation capability also support vision (image-to-image)
          // This is because Gemini image models can accept images as input for image generation
          if (
            model.startsWith('google/') &&
            tags.includes('image-generation') &&
            !tags.includes('vision')
          ) {
            tags.push('vision');
          }
          return tags;
        }
      } catch (error) {
        this.logger.warn(`[getModelTags] Failed to get gateway config for ${model}: ${error}`);
      }
      return [];
    }

    // Custom providers: get tags from modelConfigs
    const provider = llmProviders.find((p) => p.type === type && p.name === name);
    const modelConfig = provider?.modelConfigs?.[model];

    // Priority 1: Use tags if available
    if (modelConfig?.tags?.length) {
      return modelConfig.tags;
    }

    // Priority 2: Fallback to converting deprecated ability to tags
    if (modelConfig?.ability) {
      return this.abilityToTags(modelConfig.ability);
    }

    return [];
  }

  /**
   * Convert deprecated IChatModelAbility to GatewayModelTag[]
   * Used for backward compatibility with old ability format
   */
  private abilityToTags(ability: IChatModelAbility): GatewayModelTag[] {
    const tags: GatewayModelTag[] = [];
    if (ability.image) tags.push('vision');
    if (ability.pdf) tags.push('file-input');
    if (ability.toolCall) tags.push('tool-use');
    if (ability.reasoning) tags.push('reasoning');
    if (ability.imageGeneration) tags.push('image-generation');
    return tags;
  }

  /**
   * Get gateway model pricing for billing calculation
   * First checks local gatewayModels config, then falls back to API
   */
  async getGatewayModelPricing(modelId: string) {
    // First check local config (admin-configured models)
    const { aiConfig } = await this.settingService.getSetting([SettingKey.AI_CONFIG]);
    const gatewayModels = aiConfig?.gatewayModels ?? [];
    const localModel = gatewayModels.find((m) => m.id === modelId);

    if (localModel?.pricing) {
      this.logger.debug(
        `[getGatewayModelPricing] Found local pricing for ${modelId}: ${JSON.stringify(localModel.pricing)}`
      );
      return localModel.pricing;
    }

    // If not found locally, fetch from API
    try {
      const apiModel = await this.getGatewayApiModel(modelId);
      if (apiModel?.pricing) {
        this.logger.debug(
          `[getGatewayModelPricing] Found API pricing for ${modelId}: ${JSON.stringify(apiModel.pricing)}`
        );
        return apiModel.pricing;
      }
    } catch (error) {
      this.logger.warn(`[getGatewayModelPricing] Failed to fetch API pricing for ${modelId}`);
    }

    this.logger.debug(
      `[getGatewayModelPricing] No pricing found for ${modelId}, will use default rates`
    );
    return undefined;
  }

  /**
   * Get a specific model from Gateway API
   * Uses Redis cached data if available
   */
  private async getGatewayApiModel(modelId: string): Promise<IGatewayApiModel | undefined> {
    const models = await this.fetchGatewayModelsFromApi();
    return models.find((m) => m.id === modelId);
  }

  /**
   * Fetch all models from AI Gateway API with in-memory caching
   * This method is also used by setting-open-api.service.ts
   * Cache TTL: 10 minutes (static data, doesn't change frequently)
   */
  async fetchGatewayModelsFromApi(): Promise<IGatewayApiModel[]> {
    // Check in-memory cache first
    if (this.gatewayModelsCache && Date.now() < this.gatewayModelsCache.expiresAt) {
      return this.gatewayModelsCache.data;
    }

    try {
      const response = await axios.get<{ data: IGatewayApiModelRaw[] }>(
        'https://ai-gateway.vercel.sh/v1/models',
        { timeout: 10000 }
      );

      // Convert snake_case API response to camelCase
      const models = (response.data?.data || []).map(convertGatewayApiModel);

      // Update in-memory cache
      this.gatewayModelsCache = {
        data: models,
        expiresAt: Date.now() + gatewayModelsCacheTtl,
      };

      return models;
    } catch (error) {
      // If fetch fails but we have stale cache, return it
      if (this.gatewayModelsCache) {
        this.logger.warn(
          `[fetchGatewayModelsFromApi] Failed to refresh, using stale cache: ${error}`
        );
        return this.gatewayModelsCache.data;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch AI Gateway models: ${errorMessage}`);
    }
  }

  /**
   * Get attachment transfer mode from aiConfig
   * @returns 'url' (default) or 'base64'
   */
  async getAttachmentTransferMode(): Promise<'url' | 'base64'> {
    const { aiConfig } = await this.settingService.getSetting([SettingKey.AI_CONFIG]);
    return aiConfig?.attachmentTransferMode || 'url';
  }

  /**
   * Find the first model that supports vision capability from configured models.
   * Searches in order: gateway models (enabled), then custom llm providers.
   * Returns complete model info to avoid redundant lookups.
   *
   * @param llmProviders - List of configured LLM providers
   * @returns Complete vision model info, or undefined if none found
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async findFirstVisionModel(llmProviders: LLMProvider[]): Promise<
    | {
        modelKey: string;
        modelInstance: ILanguageModelV2;
        isInstance: boolean;
        tags: GatewayModelTag[];
      }
    | undefined
  > {
    const { aiConfig } = await this.settingService.getSetting([SettingKey.AI_CONFIG]);

    // 1. Check gateway models first (they are typically more capable)
    const gatewayModels = aiConfig?.gatewayModels ?? [];
    for (const model of gatewayModels) {
      if (!model.enabled) continue;

      if (model.tags?.includes('vision')) {
        const modelKey = this.buildGatewayModelKey(model.id);
        const modelInstance = await this.getModelInstance(modelKey, llmProviders);
        return {
          modelKey,
          modelInstance,
          isInstance: true, // Gateway models are always instance-level
          tags: model.tags,
        };
      }
    }

    // 2. Check custom LLM providers
    for (const provider of llmProviders) {
      const models = provider.models?.split(',').map((m) => m.trim()) ?? [];
      for (const model of models) {
        const modelConfig = provider.modelConfigs?.[model];
        if (!modelConfig) continue;

        // Check tags (new format) or ability (backward compatibility)
        const hasVision = modelConfig.tags?.includes('vision') || modelConfig.ability?.image;
        if (hasVision) {
          const modelKey = `${provider.type}@${model}@${provider.name}`;
          const modelInstance = await this.getModelInstance(modelKey, llmProviders);
          // Convert ability to tags for backward compatibility
          const tags: GatewayModelTag[] =
            modelConfig.tags ?? this.abilityToTags(modelConfig.ability ?? {});
          return {
            modelKey,
            modelInstance,
            isInstance: !!provider.isInstance,
            tags,
          };
        }
      }
    }

    return undefined;
  }
}
