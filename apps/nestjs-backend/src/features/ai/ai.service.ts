import type { OpenAIProvider } from '@ai-sdk/openai';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { IAIConfig, IAiGenerateRo, LLMProvider, LLMProviderType } from '@teable/openapi';
import { IntegrationType, SettingKey, Task } from '@teable/openapi';
import type { LanguageModelV1 } from 'ai';
import { generateText, streamText } from 'ai';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { SettingService } from '../setting/setting.service';
import { getAdaptedProviderOptions, getTaskModelKey, modelProviders } from './util';

@Injectable()
export class AiService {
  constructor(
    private readonly settingService: SettingService,
    private readonly prismaService: PrismaService,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {}

  public parseModelKey(modelKey: string) {
    const [type, model, name] = modelKey.split('@');
    return { type, model, name };
  }

  // modelKey-> type@model@name
  async getModelConfig(modelKey: string, llmProviders: LLMProvider[] = []) {
    const { type, model, name } = this.parseModelKey(modelKey);

    const providerConfig = llmProviders.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() && p.type.toLowerCase() === type.toLowerCase()
    );

    if (!providerConfig) {
      throw new Error('AI provider configuration is not set');
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
  ): Promise<LanguageModelV1>;
  async getModelInstance(
    modelKey: string,
    llmProviders: LLMProvider[] = [],
    isImageGeneration = false
  ): Promise<LanguageModelV1 | ReturnType<OpenAIProvider['image']>> {
    const { type, model, baseUrl, apiKey } = await this.getModelConfig(modelKey, llmProviders);

    if (!baseUrl || !apiKey) {
      throw new Error('AI configuration is not set');
    }

    const provider = Object.entries(modelProviders).find(([key]) =>
      type.toLowerCase().includes(key.toLowerCase())
    )?.[1];

    if (!provider) {
      throw new Error(`Unsupported AI provider: ${type}`);
    }

    const providerOptions = getAdaptedProviderOptions(type as LLMProviderType, {
      baseURL: baseUrl,
      apiKey,
    });
    const modelProvider = provider(providerOptions) as OpenAIProvider;

    return isImageGeneration
      ? (modelProvider.image(model) as ReturnType<OpenAIProvider['image']>)
      : (modelProvider(model) as LanguageModelV1);
  }

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
      throw new Error('AI configuration is not set');
    }

    if (!aiIntegrationConfig) {
      const lg = aiConfig?.chatModel?.lg;
      const sm = aiConfig?.chatModel?.sm;
      const md = aiConfig?.chatModel?.md;
      const ability = aiConfig?.chatModel?.ability;

      return {
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
    }

    if (!aiConfig?.enable) {
      return aiIntegrationConfig as IAIConfig;
    }

    const lg = aiIntegrationConfig.chatModel?.lg;
    const sm = aiIntegrationConfig.chatModel?.sm;
    const md = aiIntegrationConfig.chatModel?.md;
    const ability = aiIntegrationConfig.chatModel?.ability;
    return {
      ...aiIntegrationConfig,
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
    const { webSearchConfig, appConfig } = await this.settingService.getSetting([
      SettingKey.WEB_SEARCH_CONFIG,
      SettingKey.APP_CONFIG,
    ]);
    const { spaceId } = await this.prismaService.base.findUniqueOrThrow({
      where: { id: baseId },
    });
    const aiIntegration = await this.prismaService.integration.findFirst({
      where: { resourceId: spaceId, type: IntegrationType.AI },
    });
    const aiIntegrationConfig = aiIntegration?.config ? JSON.parse(aiIntegration.config) : null;
    return {
      webSearchApiKey: aiIntegrationConfig?.webSearchConfig?.apiKey || webSearchConfig?.apiKey,
      v0ApiKey: aiIntegrationConfig?.appConfig?.apiKey || appConfig?.apiKey,
    };
  }

  async getSimplifiedAIConfig(baseId: string) {
    try {
      const config = await this.getAIConfig(baseId);
      return {
        ...config,
        llmProviders: config.llmProviders.map(({ type, name, models, isInstance }) => ({
          type,
          name,
          models,
          isInstance,
        })),
      };
    } catch {
      return null;
    }
  }

  private async getGenerationModelInstance(baseId: string, aiGenerateRo: IAiGenerateRo) {
    const { modelKey: _modelKey, task = Task.Coding } = aiGenerateRo;
    const config = await this.getAIConfig(baseId);
    const modelKey = _modelKey ?? getTaskModelKey(config, task);
    return await this.getModelInstance(modelKey, config.llmProviders);
  }

  async generateStream(baseId: string, aiGenerateRo: IAiGenerateRo) {
    const { prompt } = aiGenerateRo;
    const modelInstance = await this.getGenerationModelInstance(baseId, aiGenerateRo);

    return await streamText({
      model: modelInstance as LanguageModelV1,
      prompt: prompt,
    });
  }

  async generateText(baseId: string, aiGenerateRo: IAiGenerateRo) {
    const { prompt } = aiGenerateRo;
    const modelInstance = await this.getGenerationModelInstance(baseId, aiGenerateRo);

    const { text } = await generateText({
      model: modelInstance as LanguageModelV1,
      prompt: prompt,
    });
    return text;
  }

  async checkInstanceAIModel(modelKey: string): Promise<boolean> {
    if (!this.baseConfig.isCloud) return false;

    const { aiConfig } = await this.settingService.getSetting();

    if (!aiConfig?.enable) return false;

    const { llmProviders } = aiConfig;
    const { type, model, name } = this.parseModelKey(modelKey);

    const providerConfig = llmProviders.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() &&
        p.type.toLowerCase() === type.toLowerCase() &&
        p.models.includes(model)
    );
    return !!providerConfig;
  }

  async getChatModelInstance(baseId: string) {
    const { chatModel, llmProviders } = await this.getAIConfig(baseId);
    if (!chatModel?.lg) {
      throw new Error('AI chat model lg is not set');
    }
    const { type, model, name } = this.parseModelKey(chatModel?.lg);
    const lgProvider = llmProviders.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() &&
        p.type.toLowerCase() === type.toLowerCase() &&
        p.models.includes(model)
    );
    if (!lgProvider) {
      throw new Error('AI provider configuration is not set');
    }
    if (!chatModel?.sm) {
      throw new Error('AI chat model sm is not set');
    }
    if (!chatModel?.md) {
      throw new Error('AI chat model md is not set');
    }

    return {
      sm: await this.getModelInstance(chatModel?.sm, llmProviders),
      md: await this.getModelInstance(chatModel?.md, llmProviders),
      lg: await this.getModelInstance(chatModel?.lg, llmProviders),
      ability: chatModel?.ability,
      isInstance: lgProvider.isInstance,
    };
  }
}
