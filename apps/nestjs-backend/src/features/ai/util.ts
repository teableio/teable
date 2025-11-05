import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { createXai } from '@ai-sdk/xai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { IAIConfig, Task } from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import { get } from 'lodash';
import { createOllama } from 'ollama-ai-provider-v2';
import { TASK_MODEL_MAP } from './constant';

export const modelProviders = {
  [LLMProviderType.OPENAI]: createOpenAI,
  [LLMProviderType.ANTHROPIC]: createAnthropic,
  [LLMProviderType.GOOGLE]: createGoogleGenerativeAI,
  [LLMProviderType.AZURE]: createAzure,
  [LLMProviderType.COHERE]: createCohere,
  [LLMProviderType.MISTRAL]: createMistral,
  [LLMProviderType.DEEPSEEK]: createDeepSeek,
  [LLMProviderType.QWEN]: createOpenAICompatible,
  [LLMProviderType.ZHIPU]: createOpenAICompatible,
  [LLMProviderType.LINGYIWANWU]: createOpenAICompatible,
  [LLMProviderType.XAI]: createXai,
  [LLMProviderType.TOGETHERAI]: createTogetherAI,
  [LLMProviderType.OLLAMA]: createOllama,
  [LLMProviderType.AMAZONBEDROCK]: createAmazonBedrock,
  [LLMProviderType.OPENROUTER]: createOpenRouter,
  [LLMProviderType.OPENAI_COMPATIBLE]: createOpenAICompatible,
} as const;

export const getAdaptedProviderOptions = (
  type: LLMProviderType,
  originalOptions: {
    name: string;
    baseURL: string;
    apiKey: string;
  }
) => {
  const { name, baseURL: originalBaseURL, apiKey: originalApiKey } = originalOptions;
  switch (type) {
    case LLMProviderType.AMAZONBEDROCK: {
      const [region, accessKeyId, secretAccessKey] = originalApiKey.split('.');
      return {
        name,
        region,
        secretAccessKey: secretAccessKey,
        accessKeyId: accessKeyId,
        baseURL: originalBaseURL,
      };
    }
    case LLMProviderType.OLLAMA:
      return { name, baseURL: originalBaseURL };
    case LLMProviderType.OPENAI_COMPATIBLE:
      return { ...originalOptions, includeUsage: true };
    default: {
      return originalOptions;
    }
  }
};

export const getTaskModelKey = (aiConfig: IAIConfig, task: Task): string | undefined => {
  const modelKey = TASK_MODEL_MAP[task];
  return get(aiConfig, modelKey) as string | undefined;
};
