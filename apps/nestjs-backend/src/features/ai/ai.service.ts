import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createCohere } from '@ai-sdk/cohere';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { Injectable } from '@nestjs/common';
import { LLMProviderType } from '@teable/openapi';
import { streamText } from 'ai';
import { SettingService } from '../setting/setting.service';
import { TASK_MODEL_MAP } from './constant';
import { Task } from './type';

@Injectable()
export class AiService {
  constructor(private readonly settingService: SettingService) {}

  readonly modelProviders = {
    [LLMProviderType.OPENAI]: createOpenAI,
    [LLMProviderType.ANTHROPIC]: createAnthropic,
    [LLMProviderType.GOOGLE]: createGoogleGenerativeAI,
    [LLMProviderType.AZURE]: createAzure,
    [LLMProviderType.COHERE]: createCohere,
    [LLMProviderType.MISTRAL]: createMistral,
  } as const;

  async getModelConfig(task: Task) {
    const { aiConfig } = await this.settingService.getSetting();
    // aiConfig?.codingModel model@provider
    const currentTaskModel = TASK_MODEL_MAP[task];
    const [model, provider] =
      (aiConfig?.[currentTaskModel as keyof typeof aiConfig] as string)?.split('@') || [];
    const llmProviders = aiConfig?.llmProviders || [];

    const providerConfig = llmProviders.find(
      (p) => p.name.toLowerCase() === provider.toLowerCase()
    );

    if (!providerConfig) {
      throw new Error('AI provider configuration is not set');
    }

    return { model, baseUrl: providerConfig.baseUrl, apiKey: providerConfig.apiKey };
  }

  async getModelInstance(
    task: Task
  ): Promise<
    ReturnType<ReturnType<(typeof this.modelProviders)[keyof typeof this.modelProviders]>>
  > {
    const config = await this.getModelConfig(task);

    if (!config.baseUrl || !config.apiKey) {
      throw new Error('AI configuration is not set');
    }

    const provider = Object.entries(this.modelProviders).find(([key]) =>
      config.model.toLowerCase().includes(key.toLowerCase())
    )?.[1];

    if (!provider) {
      throw new Error(`Unsupported AI provider for model: ${config.model}`);
    }

    return provider({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    })(config.model);
  }

  async generate(prompt: string, task: Task = Task.Coding) {
    const modelInstance = await this.getModelInstance(task);

    return await streamText({
      model: modelInstance,
      prompt: prompt,
    });
  }
}
