import { promises as dns } from 'node:dns';
import { createServer, type Server } from 'node:http';
import { LLMProviderType } from '@teable/openapi';
import { generateText, type LanguageModel } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import {
  assertAiProviderBaseUrlsAllowed,
  instanceAdminProviderFetch,
  isAiProviderBaseUrlBlocked,
  modelProviders,
  setInstanceAiProviderOriginsResolver,
} from './util';

/**
 * A space integration's provider `baseUrl` is tenant input, so its requests go
 * through the SSRF-guarded fetch (GHSA-jvm6-86c5-f8j8). A real loopback server
 * stands in for an internal service. On cloud it must never see a request
 * unless its origin is trusted (env, or the instance admin's own provider
 * config) or protection is switched off; on self-hosted only the cloud-metadata
 * addresses stay out of reach.
 */
describe('AI provider SSRF guard', () => {
  let server: Server;
  let port: number;
  let requests: string[];

  const completion = {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 0,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };

  beforeEach(
    () =>
      new Promise<void>((resolve) => {
        requests = [];
        server = createServer((req, res) => {
          requests.push(`${req.method} ${req.url}`);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(completion));
        });
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as { port: number }).port;
          // Cloud unless a test says otherwise: the strict mode.
          process.env.NEXT_BUILD_ENV_EDITION = 'CLOUD';
          resolve();
        });
      })
  );

  afterEach(async () => {
    delete process.env.NEXT_BUILD_ENV_EDITION;
    setInstanceAiProviderOriginsResolver(async () => []);
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
    delete process.env.TEABLE_SSRF_TRUSTED_ORIGINS;
    delete process.env.PUBLIC_ORIGIN;
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const generate = (type: keyof typeof modelProviders, transport?: typeof fetch) => {
    const factory = modelProviders[type] as unknown as (
      options: unknown
    ) => (model: string) => LanguageModel;
    const provider = factory({
      name: 'test',
      baseURL: `http://127.0.0.1:${port}/v1`,
      apiKey: 'x',
      includeUsage: true,
      ...(transport ? { fetch: transport } : {}),
    });
    // No retries: the guard rejects at connect time and retry back-off would
    // only slow the assertion down.
    return generateText({ model: provider('m'), prompt: 'hi', maxRetries: 0 });
  };

  describe('modelProviders', () => {
    it('blocks an OpenAI-compatible provider on a loopback base URL', async () => {
      await expect(generate(LLMProviderType.OPENAI_COMPATIBLE)).rejects.toThrow();
      expect(requests).toEqual([]);
    });

    it('blocks a stock SDK provider too (wrapped factory)', async () => {
      await expect(generate(LLMProviderType.OPENAI)).rejects.toThrow();
      expect(requests).toEqual([]);
    });

    it('reaches the server when its exact origin is trusted', async () => {
      process.env.TEABLE_SSRF_TRUSTED_ORIGINS = `http://127.0.0.1:${port}`;
      const { text } = await generate(LLMProviderType.OPENAI_COMPATIBLE);
      expect(text).toBe('ok');
      expect(requests).toEqual(['POST /v1/chat/completions']);
    });

    it('reaches the server when SSRF protection is disabled (env opt-out parity)', async () => {
      process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
      const { text } = await generate(LLMProviderType.OPENAI_COMPATIBLE);
      expect(text).toBe('ok');
      expect(requests).toEqual(['POST /v1/chat/completions']);
    });

    it('re-reads the opt-out per call after a guarded call', async () => {
      await expect(generate(LLMProviderType.OPENAI_COMPATIBLE)).rejects.toThrow();
      process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
      await expect(generate(LLMProviderType.OPENAI_COMPATIBLE)).resolves.toBeDefined();
      delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
      await expect(generate(LLMProviderType.OPENAI_COMPATIBLE)).rejects.toThrow();
      expect(requests).toEqual(['POST /v1/chat/completions']);
    });
  });

  describe('instance-configured providers', () => {
    it("trusts the origins of the admin's own providers, and only those", async () => {
      setInstanceAiProviderOriginsResolver(async () => [`http://127.0.0.1:${port}/v1`, null]);
      const { text } = await generate(LLMProviderType.OPENAI_COMPATIBLE);
      expect(text).toBe('ok');
      await expect(isAiProviderBaseUrlBlocked(`http://127.0.0.1:${port}/v1`)).resolves.toBe(false);
      await expect(isAiProviderBaseUrlBlocked(`http://127.0.0.1:${port + 1}/v1`)).resolves.toBe(
        true
      );
    });

    it('lets the instance admin routes reach any provider they test', async () => {
      const compatible = await generate(
        LLMProviderType.OPENAI_COMPATIBLE,
        instanceAdminProviderFetch
      );
      expect(compatible.text).toBe('ok');
      // The stock SDK speaks another wire format to this stub; reaching it is the point.
      await generate(LLMProviderType.OPENAI, instanceAdminProviderFetch).catch(() => undefined);
      expect(requests).toHaveLength(2);
    });
  });

  describe('self-hosted', () => {
    beforeEach(() => {
      delete process.env.NEXT_BUILD_ENV_EDITION;
    });

    it('reaches a provider on the private network', async () => {
      const { text } = await generate(LLMProviderType.OPENAI_COMPATIBLE);
      expect(text).toBe('ok');
      await expect(isAiProviderBaseUrlBlocked('http://10.0.0.5:11434/v1')).resolves.toBe(false);
      await expect(isAiProviderBaseUrlBlocked(`http://127.0.0.1:${port}/v1`)).resolves.toBe(false);
    });

    it('still refuses the cloud-metadata addresses', async () => {
      await expect(isAiProviderBaseUrlBlocked('http://169.254.169.254/latest')).resolves.toBe(true);
      const lookup = vi.spyOn(dns, 'lookup') as unknown as ReturnType<typeof vi.fn>;
      lookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
      await expect(isAiProviderBaseUrlBlocked('http://metadata.internal/v1')).resolves.toBe(true);
    });
  });

  describe('isAiProviderBaseUrlBlocked', () => {
    it('blocks literal loopback, link-local and private addresses', async () => {
      await expect(isAiProviderBaseUrlBlocked(`http://127.0.0.1:${port}/v1`)).resolves.toBe(true);
      await expect(isAiProviderBaseUrlBlocked('http://[::1]:11434/v1')).resolves.toBe(true);
      await expect(isAiProviderBaseUrlBlocked('http://169.254.169.254/latest')).resolves.toBe(true);
      await expect(isAiProviderBaseUrlBlocked('http://10.0.0.5:8000/v1')).resolves.toBe(true);
    });

    it('allows a public literal address without a lookup', async () => {
      const lookup = vi.spyOn(dns, 'lookup');
      await expect(isAiProviderBaseUrlBlocked('https://8.8.8.8/v1')).resolves.toBe(false);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('resolves hostnames and blocks private answers', async () => {
      const lookup = vi.spyOn(dns, 'lookup') as unknown as ReturnType<typeof vi.fn>;
      lookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
      await expect(isAiProviderBaseUrlBlocked('http://ollama.internal:11434/v1')).resolves.toBe(
        true
      );
      lookup.mockResolvedValueOnce([{ address: '104.18.2.1', family: 4 }]);
      await expect(isAiProviderBaseUrlBlocked('https://api.example.com/v1')).resolves.toBe(false);
    });

    it('fails closed on resolver errors and malformed URLs', async () => {
      const lookup = vi.spyOn(dns, 'lookup') as unknown as ReturnType<typeof vi.fn>;
      lookup.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
      await expect(isAiProviderBaseUrlBlocked('https://missing.example/v1')).resolves.toBe(true);
      await expect(isAiProviderBaseUrlBlocked('not a url')).resolves.toBe(true);
    });

    it('trusts an exact configured origin and the env opt-out', async () => {
      process.env.TEABLE_SSRF_TRUSTED_ORIGINS = 'http://127.0.0.1:11434';
      await expect(isAiProviderBaseUrlBlocked('http://127.0.0.1:11434/v1')).resolves.toBe(false);
      // Same host, different port: origins are exact.
      await expect(isAiProviderBaseUrlBlocked('http://127.0.0.1:11435/v1')).resolves.toBe(true);
      delete process.env.TEABLE_SSRF_TRUSTED_ORIGINS;
      process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
      await expect(isAiProviderBaseUrlBlocked('http://127.0.0.1:11435/v1')).resolves.toBe(false);
    });
  });

  describe('assertAiProviderBaseUrlsAllowed', () => {
    it('throws a validation error naming the blocked URL', async () => {
      const baseUrl = `http://127.0.0.1:${port}/v1`;
      await expect(
        assertAiProviderBaseUrlsAllowed([{ baseUrl: 'https://8.8.8.8/v1' }, { baseUrl }])
      ).rejects.toMatchObject({
        message: expect.stringContaining(baseUrl),
      });
      await expect(assertAiProviderBaseUrlsAllowed([{ baseUrl }])).rejects.toBeInstanceOf(
        CustomHttpException
      );
    });

    it('skips providers without a base URL', async () => {
      await expect(
        assertAiProviderBaseUrlsAllowed([{ baseUrl: undefined }, { baseUrl: '' }])
      ).resolves.toBeUndefined();
    });
  });
});
