import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { createXai } from '@ai-sdk/xai';
import { LLMProviderType } from '@teable/openapi';
import { createOllama } from 'ollama-ai-provider';
import { createQwen } from 'qwen-ai-provider';

export const modelProviders = {
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
  [LLMProviderType.TOGETHERAI]: createTogetherAI,
  [LLMProviderType.OLLAMA]: createOllama,
} as const;
