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

/**
 * Fix non-standard OpenAI compatible API streaming response.
 * Some API proxies return `role: ""` instead of proper format.
 * This uses regex replacement which is simpler and more robust than parsing.
 */
const fixStreamText = (text: string): string => {
  // Replace "role":"" with nothing (remove the field)
  // This regex handles the field whether it's first, middle, or last in the object
  // comma followed by role (if last field)

  return text
    .replace(/"role":"",/g, '') // role followed by comma
    .replace(/,"role":""/g, '');
};

/**
 * Custom fetch wrapper that fixes non-standard OpenAI compatible API responses.
 * Some API proxies return invalid format like `role: ""` instead of `role: "assistant"`.
 * This wrapper transforms the streaming response to fix such issues.
 */
const createFixingFetch = (): typeof fetch => {
  return async (input, init) => {
    const response = await fetch(input, init);

    // Only transform if there's a body (streaming responses)
    if (!response.body) {
      return response;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const transformedStream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();

        if (done) {
          controller.close();
          return;
        }

        const text = decoder.decode(value, { stream: true });
        const fixedText = fixStreamText(text);

        controller.enqueue(encoder.encode(fixedText));
      },
    });

    return new Response(transformedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
};

/**
 * Wrapper for OpenAI compatible providers that:
 * 1. Forces Chat Completions API instead of Responses API
 * 2. Uses custom fetch to fix non-standard API responses
 */
const createOpenAICompatibleWrapper = (
  options: Parameters<typeof createOpenAICompatible>[0]
): ReturnType<typeof createOpenAICompatible> => {
  return createOpenAICompatible({
    ...options,
    // Use custom fetch to fix non-standard responses
    fetch: createFixingFetch(),
  });
};

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
  [LLMProviderType.OPENAI_COMPATIBLE]: createOpenAICompatibleWrapper,
  // AI_GATEWAY is handled separately in ai.service.ts using createGateway from 'ai'
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
    case LLMProviderType.AI_GATEWAY:
      // AI Gateway - use official gateway provider options
      // Gateway handles provider routing via modelId format (e.g., "google/gemini-3-pro-image")
      // See: https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway
      // SDK default baseURL: https://ai-gateway.vercel.sh/v1/ai
      return {
        baseURL: originalBaseURL || undefined,
        apiKey: originalApiKey,
      };
    default: {
      return originalOptions;
    }
  }
};

export const getTaskModelKey = (aiConfig: IAIConfig, task: Task): string | undefined => {
  const modelKey = TASK_MODEL_MAP[task];
  return get(aiConfig, modelKey) as string | undefined;
};
