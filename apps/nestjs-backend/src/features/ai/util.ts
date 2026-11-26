import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
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
import { HttpErrorCode } from '@teable/core';
import type { IAIConfig, LLMProvider, Task } from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import {
  createSsrfSafeFetch,
  createTrustedUrlPredicate,
  isBlockedAddress,
  isCloudMetadataAddress,
  normalizeOrigins,
  type ISsrfSafeFetchFn,
} from '@teable/v2-utils';
import { get } from 'lodash';
import { createOllama } from 'ollama-ai-provider-v2';
import { CustomHttpException } from '../../custom.exception';
import { TASK_MODEL_MAP } from './constant';

const MINIMAX_IMAGE_MODELS = new Set(['image-01', 'image-01-live']);

const toBase64 = (bytes: ArrayBuffer): string => Buffer.from(bytes).toString('base64');

/**
 * MiniMax image generation is close to OpenAI's image API but uses a distinct
 * path, request fields, and `data.image_urls` response. Keep the regular
 * OpenAI provider for language models and adapt only image calls here.
 */
export const createMiniMaxImageFetch = (baseFetch: typeof fetch): typeof fetch => async (input, init) => {
  const requestUrl =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!requestUrl.endsWith('/images/generations') || !init?.body) {
    return baseFetch(input, init);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(String(init.body)) as Record<string, unknown>;
  } catch {
    return baseFetch(input, init);
  }
  const model = typeof body.model === 'string' ? body.model : '';
  if (!MINIMAX_IMAGE_MODELS.has(model)) {
    return baseFetch(input, init);
  }

  const targetBody: Record<string, unknown> = {
    model,
    prompt: body.prompt,
    n: body.n,
    response_format: body.response_format === 'b64_json' ? 'base64' : body.response_format,
  };
  if (typeof body.size === 'string') {
    const [width, height] = body.size.split('x').map(Number);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      targetBody.width = width;
      targetBody.height = height;
    }
  }
  for (const field of ['subject_reference', 'aspect_ratio', 'seed', 'prompt_optimizer']) {
    if (body[field] !== undefined) targetBody[field] = body[field];
  }

  const response = await baseFetch(
    requestUrl.replace(/\/images\/generations$/, '/image_generation'),
    { ...init, body: JSON.stringify(targetBody) },
  );
  if (!response.ok) return response;

  const payload = (await response.json()) as {
    data?: { image_urls?: unknown };
    base_resp?: { status_code?: number };
  };
  if (payload.base_resp?.status_code && payload.base_resp.status_code !== 0) {
    return new Response(JSON.stringify(payload), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const values = Array.isArray(payload.data?.image_urls) ? payload.data.image_urls : [];
  const images = await Promise.all(
    values
      .filter((value): value is string => typeof value === 'string')
      .map(async (value) => {
        if (/^https?:\/\//i.test(value)) {
          const imageResponse = await baseFetch(value, { signal: init.signal });
          if (!imageResponse.ok) {
            throw new Error(`MiniMax image download failed: ${imageResponse.status}`);
          }
          return { b64_json: toBase64(await imageResponse.arrayBuffer()) };
        }
        return { b64_json: value.replace(/^data:[^;]+;base64,/, '') };
      })
  );
  return new Response(JSON.stringify({ data: images }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const createMiniMaxProvider = (options: Parameters<typeof createOpenAI>[0]) =>
  createOpenAI({ ...options, fetch: createMiniMaxImageFetch(options.fetch ?? fetch) });

// Same switch `@teable/v2-utils` honours (it is not exported from its index).
const isSsrfProtectionDisabled = () => process.env.TEABLE_SSRF_PROTECTION_DISABLED === 'true';

// Same source as BaseConfig.isCloud; read per call so late env setup is honoured.
const isCloudEdition = () => process.env.NEXT_BUILD_ENV_EDITION?.toUpperCase() === 'CLOUD';

/**
 * Who configured a provider decides how far its `baseUrl` may reach:
 * - the instance admin's own providers and AI gateway are operator
 *   configuration, trusted the way `TEABLE_SSRF_TRUSTED_ORIGINS` is (a LAN
 *   model on self-hosted, a VPC-internal gateway on cloud);
 * - a space integration is tenant input (GHSA-jvm6-86c5-f8j8): on cloud it may
 *   only reach public peers; on self-hosted the private network too — the
 *   tenants share the operator's network — but never the cloud-metadata
 *   addresses.
 * The instance origins come from a resolver the AI module registers at
 * startup, memoized briefly so a request does not read settings every time.
 */
type IInstanceAiOriginsResolver = () => Promise<readonly (string | null | undefined)[]>;

const INSTANCE_AI_ORIGINS_TTL_MS = 30_000;
let resolveInstanceAiOrigins: IInstanceAiOriginsResolver = async () => [];
let instanceAiOriginsMemo: { at: number; origins: Promise<ReadonlySet<string>> } | undefined;

export const setInstanceAiProviderOriginsResolver = (resolver: IInstanceAiOriginsResolver) => {
  resolveInstanceAiOrigins = resolver;
  instanceAiOriginsMemo = undefined;
};

const getInstanceAiOrigins = (): Promise<ReadonlySet<string>> => {
  const now = Date.now();
  if (!instanceAiOriginsMemo || now - instanceAiOriginsMemo.at > INSTANCE_AI_ORIGINS_TTL_MS) {
    const origins = resolveInstanceAiOrigins()
      .then((urls) => new Set(normalizeOrigins(urls.map((url) => url ?? undefined))))
      .catch(() => new Set<string>());
    instanceAiOriginsMemo = { at: now, origins };
  }
  return instanceAiOriginsMemo.origins;
};

const isInstanceAiProviderUrl = async (url: string): Promise<boolean> => {
  try {
    return (await getInstanceAiOrigins()).has(new URL(url).origin);
  } catch {
    return false;
  }
};

let guardedFetch: { cloud: boolean; fetch: ISsrfSafeFetchFn } | undefined;

const getGuardedFetch = (): ISsrfSafeFetchFn => {
  const cloud = isCloudEdition();
  if (guardedFetch?.cloud !== cloud) {
    guardedFetch = { cloud, fetch: createSsrfSafeFetch({ allowPrivateNetwork: !cloud }) };
  }
  return guardedFetch.fetch;
};

/**
 * Fetch for every request to a configured AI provider. Instance-configured
 * origins go out as they are; anything else (a space integration) goes through
 * the SSRF-guarded undici dispatcher, which re-checks the peer address on every
 * hop and re-reads `TEABLE_SSRF_TRUSTED_ORIGINS` / `PUBLIC_ORIGIN` per dispatch.
 * `Request` inputs are reduced to their URL — the AI SDKs only pass strings.
 */
export const aiProviderFetch: typeof fetch = async (input, init) => {
  if (isSsrfProtectionDisabled()) {
    return fetch(input, init);
  }
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (await isInstanceAiProviderUrl(url)) {
    return fetch(input, init);
  }
  return getGuardedFetch()(url, init as Parameters<ISsrfSafeFetchFn>[1]);
};

let instanceAdminFetch: ISsrfSafeFetchFn | undefined;

/**
 * For the instance admin's own routes (testing a provider before saving it,
 * batch tests, gateway and transcription key checks): operator input, not
 * tenant input, so the private network stays reachable (a LAN model, a
 * VPC-internal gateway) on every edition. The cloud-metadata addresses do not:
 * these routes hand the upstream's answer back in their error messages, which
 * would make them a way to read instance credentials.
 */
export const instanceAdminProviderFetch: typeof fetch = (input, init) => {
  if (isSsrfProtectionDisabled()) {
    return fetch(input, init);
  }
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  instanceAdminFetch ??= createSsrfSafeFetch({ allowPrivateNetwork: true });
  return instanceAdminFetch(url, init as Parameters<ISsrfSafeFetchFn>[1]);
};

/**
 * Wraps a provider factory so its requests go through `aiProviderFetch`
 * unless the caller supplies its own `fetch`.
 */
const withProviderFetch =
  <TOptions extends { fetch?: typeof fetch }, TProvider>(
    factory: (options: TOptions) => TProvider
  ) =>
  (options?: TOptions): TProvider =>
    factory({ fetch: aiProviderFetch, ...options } as TOptions);

/**
 * Defence in depth for a space integration's `llmProviders[].baseUrl`: the
 * guarded fetch already refuses a disallowed peer at connect time, but only as
 * an opaque upstream error mid-request. Checking the URL when it is saved or
 * tested surfaces an actionable message instead. Same trust model as the
 * fetch; an unresolvable host fails closed.
 */
export const isAiProviderBaseUrlBlocked = async (baseUrl: string): Promise<boolean> => {
  if (isSsrfProtectionDisabled()) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return true;
  }
  if (createTrustedUrlPredicate()(parsed.href) || (await isInstanceAiProviderUrl(parsed.href))) {
    return false;
  }
  const isRejected = isCloudEdition() ? isBlockedAddress : isCloudMetadataAddress;
  const hostname =
    parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
  if (isIP(hostname)) {
    return isRejected(hostname);
  }
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    return addresses.length === 0 || addresses.some(({ address }) => isRejected(address));
  } catch {
    return true;
  }
};

export const assertAiProviderBaseUrlsAllowed = async (
  providers: readonly Pick<LLMProvider, 'baseUrl'>[]
): Promise<void> => {
  for (const { baseUrl } of providers) {
    if (baseUrl && (await isAiProviderBaseUrlBlocked(baseUrl))) {
      throw new CustomHttpException(
        `AI provider base URL ${baseUrl} points to a private or unresolvable network address`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.ai.providerBaseUrlBlocked',
            context: { baseUrl },
          },
        }
      );
    }
  }
};

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
    .replaceAll('"role":"",', '') // role followed by comma
    .replaceAll(',"role":""', '');
};

/**
 * Custom fetch wrapper that fixes non-standard OpenAI compatible API responses.
 * Some API proxies return invalid format like `role: ""` instead of `role: "assistant"`.
 * This wrapper transforms the streaming response to fix such issues.
 */
const createFixingFetch = (baseFetch: typeof fetch = aiProviderFetch): typeof fetch => {
  return async (input, init) => {
    const response = await baseFetch(input, init);

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
    // Use custom fetch to fix non-standard responses, on top of the caller's
    // transport when it brings one (instance admin routes).
    fetch: createFixingFetch(options?.fetch),
  });
};

// Every factory takes `fetch`; keep it that way when adding providers so the
// SSRF guard stays on the only path to a workspace-configured `baseUrl`.
export const modelProviders = {
  [LLMProviderType.OPENAI]: withProviderFetch(createOpenAI),
  [LLMProviderType.ANTHROPIC]: withProviderFetch(createAnthropic),
  [LLMProviderType.GOOGLE]: withProviderFetch(createGoogleGenerativeAI),
  [LLMProviderType.AZURE]: withProviderFetch(createAzure),
  [LLMProviderType.COHERE]: withProviderFetch(createCohere),
  [LLMProviderType.MISTRAL]: withProviderFetch(createMistral),
  [LLMProviderType.DEEPSEEK]: withProviderFetch(createDeepSeek),
  [LLMProviderType.MINIMAX]: withProviderFetch(createMiniMaxProvider),
  [LLMProviderType.QWEN]: withProviderFetch(createOpenAICompatible),
  [LLMProviderType.ZHIPU]: withProviderFetch(createOpenAICompatible),
  [LLMProviderType.LINGYIWANWU]: withProviderFetch(createOpenAICompatible),
  [LLMProviderType.XAI]: withProviderFetch(createXai),
  [LLMProviderType.TOGETHERAI]: withProviderFetch(createTogetherAI),
  [LLMProviderType.OLLAMA]: withProviderFetch(createOllama),
  [LLMProviderType.AMAZONBEDROCK]: withProviderFetch(createAmazonBedrock),
  [LLMProviderType.OPENROUTER]: withProviderFetch(createOpenRouter),
  [LLMProviderType.OPENAI_COMPATIBLE]: createOpenAICompatibleWrapper,
  // AI_GATEWAY is handled separately in ai.service.ts using createGateway from 'ai';
  // every createGateway call site must pass `fetch: aiProviderFetch` too.
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
