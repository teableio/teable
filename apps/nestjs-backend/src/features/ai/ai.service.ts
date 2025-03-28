import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { IAIConfig, IAiGenerateRo, LLMProvider } from '@teable/openapi';
import { IntegrationType, LLMProviderType, Task } from '@teable/openapi';
import { generateText, streamText } from 'ai';
import { createQwen } from 'qwen-ai-provider';
import { SettingService } from '../setting/setting.service';
import { TASK_MODEL_MAP } from './constant';

@Injectable()
export class AiService {
  constructor(
    private readonly settingService: SettingService,
    private readonly prismaService: PrismaService
  ) {}

  readonly modelProviders = {
    [LLMProviderType.OPENAI]: createOpenAI,
    [LLMProviderType.ANTHROPIC]: createAnthropic,
    [LLMProviderType.GOOGLE]: createGoogleGenerativeAI,
    [LLMProviderType.AZURE]: createAzure,
    [LLMProviderType.COHERE]: createCohere,
    [LLMProviderType.MISTRAL]: createMistral,
    [LLMProviderType.DEEPSEEK]: createDeepSeek,
    [LLMProviderType.QWEN]: createQwen,
    [LLMProviderType.ZHIPU]: createOpenAI,
    [LLMProviderType.LINGYIWANWU]: createOpenAI,
    [LLMProviderType.XAI]: createXai,
  } as const;

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
    llmProviders: LLMProvider[] = []
  ): Promise<
    ReturnType<ReturnType<(typeof this.modelProviders)[keyof typeof this.modelProviders]>>
  > {
    const { type, model, baseUrl, apiKey } = await this.getModelConfig(modelKey, llmProviders);

    if (!baseUrl || !apiKey) {
      throw new Error('AI configuration is not set');
    }

    const provider = Object.entries(this.modelProviders).find(([key]) =>
      type.toLowerCase().includes(key.toLowerCase())
    )?.[1];

    if (!provider) {
      throw new Error(`Unsupported AI provider: ${type}`);
    }

    return provider({
      baseURL: baseUrl,
      apiKey,
    })(model);
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
      return {
        ...aiConfig,
        llmProviders: aiConfig?.llmProviders.map((provider) => ({
          ...provider,
          isInstance: true,
        })),
      } as IAIConfig;
    }

    if (!aiConfig?.enable) {
      return aiIntegrationConfig as IAIConfig;
    }

    return {
      llmProviders: [
        ...aiIntegrationConfig.llmProviders,
        ...aiConfig.llmProviders.map((provider) => ({
          ...provider,
          isInstance: true,
        })),
      ],
      codingModel: aiIntegrationConfig.codingModel ?? aiConfig.codingModel,
      embeddingModel: aiIntegrationConfig.embeddingModel ?? aiConfig.embeddingModel,
      translationModel: aiIntegrationConfig.translationModel ?? aiConfig.translationModel,
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
    } catch (error) {
      return null;
    }
  }

  private async getGenerationModelInstance(baseId: string, aiGenerateRo: IAiGenerateRo) {
    const { modelKey: _modelKey, task = Task.Coding } = aiGenerateRo;
    const config = await this.getAIConfig(baseId);
    const currentTaskModel = TASK_MODEL_MAP[task];
    const modelKey = _modelKey ?? (config[currentTaskModel as keyof typeof config] as string);
    return await this.getModelInstance(modelKey, config.llmProviders);
  }

  async generateStream(baseId: string, aiGenerateRo: IAiGenerateRo) {
    const { prompt } = aiGenerateRo;
    const modelInstance = await this.getGenerationModelInstance(baseId, aiGenerateRo);

    return await streamText({
      model: modelInstance,
      prompt: prompt,
    });
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
}
