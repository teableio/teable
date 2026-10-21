import { promises as dnsPromises } from 'node:dns';
import { createServer, type Server } from 'node:http';
import { LLMProviderType } from '@teable/openapi';
import { APICallError, generateImage as aiGenerateImage, generateText as aiGenerateText } from 'ai';
import axios from 'axios';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingOpenApiService } from './setting-open-api.service';

vi.mock('../../mail-sender/mail-helpers', () => ({
  verifyTransport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  createGateway: vi.fn(),
  generateImage: vi.fn(),
  generateText: vi.fn(),
  tool: vi.fn((config) => config),
}));

const providerName = 'custom-openai';
const apiKey = 'sk-test';
const openAIBaseUrl = 'https://api.openai.com/v1';
const gptImage2Model = 'gpt-image-2';
const gptImage2ModelKey = `${LLMProviderType.OPENAI}@${gptImage2Model}@${providerName}`;
const testImageBuffer = Buffer.from([1, 2, 3]);

describe('SettingOpenApiService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BUILD_VERSION;
    delete process.env.NEXT_PUBLIC_BUILD_VERSION;
    delete process.env.APP_VERSION;
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const createService = () =>
    new SettingOpenApiService(
      undefined as never,
      undefined as never,
      { provider: 'local' } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { emitAtomic: vi.fn() } as never
    );

  const createServiceWithSettingService = (
    settingService: {
      getSetting: ReturnType<typeof vi.fn>;
      updateSetting: ReturnType<typeof vi.fn>;
    },
    audit: { emitAtomic: ReturnType<typeof vi.fn> } = { emitAtomic: vi.fn() }
  ) =>
    new SettingOpenApiService(
      undefined as never,
      undefined as never,
      { provider: 'local' } as never,
      undefined as never,
      undefined as never,
      settingService as never,
      undefined as never,
      audit as never
    );

  it('sends runtime build version to public access checker', async () => {
    process.env.BUILD_VERSION = '20260429.1';
    process.env.NEXT_PUBLIC_BUILD_VERSION = 'legacy-build';
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        success: true,
        statusCode: 200,
        latencyMs: 10,
        checkedFrom: 'test',
      },
    });

    await (
      createService() as unknown as {
        checkUrlAccessible: (
          url: string,
          setting: { instanceId?: string; createdTime?: string }
        ) => Promise<unknown>;
      }
    ).checkUrlAccessible('https://teable.ai/health', {
      instanceId: 'ins_123',
      createdTime: '2026-04-29T00:00:00.000Z',
    });

    expect(getSpy).toHaveBeenCalledWith(
      'https://access-checker.teable.ai/check',
      expect.objectContaining({
        params: {
          url: 'https://teable.ai/health',
          instanceId: 'ins_123',
          version: '20260429.1',
          deployedAt: '2026-04-29T00:00:00.000Z',
        },
      })
    );
  });

  it('updates an AI config section without dropping unrelated fields', async () => {
    const settingService = {
      getSetting: vi.fn().mockResolvedValue({
        aiConfig: {
          llmProviders: [
            {
              type: LLMProviderType.OPENAI,
              name: 'old-name',
              models: 'gpt-4o',
            },
          ],
          gatewayModels: [{ id: 'openai/gpt-4o', label: 'GPT-4o', enabled: true }],
          chatModel: { lg: `${LLMProviderType.OPENAI}@gpt-4o@old-name` },
        },
      }),
      updateSetting: vi.fn().mockImplementation((payload) => Promise.resolve(payload)),
    };
    const service = createServiceWithSettingService(settingService);

    const result = await service.updateAiConfig({
      section: 'defaultModels',
      patch: { chatModel: { lg: `${LLMProviderType.OPENAI}@gpt-4o@new-name` } },
    });

    expect(settingService.updateSetting).toHaveBeenCalledWith({
      aiConfig: expect.objectContaining({
        llmProviders: [
          {
            type: LLMProviderType.OPENAI,
            name: 'teable',
            models: 'gpt-4o',
          },
        ],
        gatewayModels: [{ id: 'openai/gpt-4o', label: 'GPT-4o', enabled: true }],
        chatModel: { lg: `${LLMProviderType.OPENAI}@gpt-4o@teable` },
      }),
    });
    expect(result).toEqual({
      aiConfig: {
        chatModel: { lg: `${LLMProviderType.OPENAI}@gpt-4o@teable` },
      },
    });
  });

  it('restores the provider-list invariant when updating a partial AI config', async () => {
    const settingService = {
      getSetting: vi.fn().mockResolvedValue({
        aiConfig: { capabilities: { disableActions: [] } },
      }),
      updateSetting: vi.fn().mockResolvedValue(undefined),
    };
    const service = createServiceWithSettingService(settingService);

    await service.updateAiConfig({
      section: 'capabilities',
      patch: { capabilities: { disableActions: ['chat'] } },
    });

    expect(settingService.updateSetting).toHaveBeenCalledWith({
      aiConfig: {
        capabilities: { disableActions: ['chat'] },
        llmProviders: [],
      },
    });
  });

  it('refuses a provider list where two providers of one type list the same model', async () => {
    const settingService = {
      getSetting: vi.fn().mockResolvedValue({ aiConfig: { llmProviders: [] } }),
      updateSetting: vi.fn().mockResolvedValue(undefined),
    };
    const service = createServiceWithSettingService(settingService);

    await expect(
      service.updateAiConfig({
        section: 'llmApi',
        patch: {
          llmProviders: [
            { type: LLMProviderType.OPENAI, name: 'a', displayName: 'GPT', models: 'gpt-4o' },
            { type: LLMProviderType.OPENAI, name: 'b', displayName: 'Mirror', models: 'gpt-4o' },
          ],
        },
      })
    ).rejects.toThrow('listed by both "GPT" and "Mirror"');
    expect(settingService.updateSetting).not.toHaveBeenCalled();
  });

  it('normalizes a null provider-list patch to an empty list', async () => {
    const settingService = {
      getSetting: vi.fn().mockResolvedValue({
        aiConfig: {
          llmProviders: [{ type: LLMProviderType.OPENAI, name: 'teable', models: 'gpt-4o' }],
        },
      }),
      updateSetting: vi.fn().mockResolvedValue(undefined),
    };
    const service = createServiceWithSettingService(settingService);

    const result = await service.updateAiConfig({
      section: 'llmApi',
      patch: { llmProviders: null },
    });

    expect(settingService.updateSetting).toHaveBeenCalledWith({
      aiConfig: { llmProviders: [] },
    });
    expect(result).toEqual({ aiConfig: { llmProviders: [] } });
  });
});

describe('SettingOpenApiService audit', () => {
  const instanceResourceId = 'instance';
  const secretApiKey = 'sk-secret-value';

  const createAuditedService = (settingState: Record<string, unknown>) => {
    const settingService = {
      getSetting: vi.fn().mockResolvedValue(settingState),
      updateSetting: vi.fn().mockResolvedValue(undefined),
    };
    const audit = { emitAtomic: vi.fn().mockResolvedValue(undefined) };
    const storageAdapter = {
      uploadFileWidthPath: vi.fn().mockResolvedValue({ hash: 'logo-hash' }),
    };
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prismaService = { txClient: () => ({ attachments: { upsert } }) };
    const cls = { get: vi.fn().mockReturnValue('usrAdmin') };
    const service = new SettingOpenApiService(
      prismaService as never,
      undefined as never,
      { provider: 'local' } as never,
      storageAdapter as never,
      cls as never,
      settingService as never,
      undefined as never,
      audit as never
    );
    return { service, settingService, audit };
  };

  it('records the changed setting keys, with values for flags only', async () => {
    const { service, audit } = createAuditedService({
      disallowSignUp: false,
      enableWaitlist: true,
      brandName: 'Old brand',
    });

    await service.updateSetting({
      disallowSignUp: true,
      enableWaitlist: true,
      brandName: 'New brand',
      notifyMailTransportConfig: {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        sender: 'noreply@example.com',
        senderName: 'Teable',
        auth: { user: 'mailer', pass: secretApiKey },
      },
    });

    expect(audit.emitAtomic).toHaveBeenCalledTimes(1);
    const input = audit.emitAtomic.mock.calls[0][0];
    expect(input).toMatchObject({
      action: 'admin.setting.update',
      resourceId: instanceResourceId,
      params: {
        changedKeys: expect.arrayContaining([
          'disallowSignUp',
          'brandName',
          'notifyMailTransportConfig.host',
          'notifyMailTransportConfig.auth.pass',
        ]),
        before: { disallowSignUp: false, brandName: 'Old brand' },
        after: { disallowSignUp: true, brandName: 'New brand' },
      },
    });
    expect(input.params.changedKeys).not.toContain('enableWaitlist');
    expect(JSON.stringify(input)).not.toContain(secretApiKey);
  });

  it('writes no row when the patch changes nothing', async () => {
    const { service, settingService, audit } = createAuditedService({ disallowSignUp: true });

    await service.updateSetting({ disallowSignUp: true });

    expect(settingService.updateSetting).toHaveBeenCalled();
    expect(audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('records which AI config keys changed but never the provider API keys', async () => {
    const { service, audit } = createAuditedService({
      aiConfig: {
        llmProviders: [{ type: LLMProviderType.OPENAI, name: 'teable', models: 'gpt-4o' }],
        chatModel: { lg: `${LLMProviderType.OPENAI}@gpt-4o@teable` },
      },
    });

    await service.updateAiConfig({
      section: 'llmApi',
      patch: {
        llmProviders: [
          {
            type: LLMProviderType.OPENAI,
            name: 'teable',
            models: 'gpt-4o',
            apiKey: secretApiKey,
          },
        ],
      },
    });

    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'admin.setting.update-ai-config',
      resourceId: instanceResourceId,
      params: { changedKeys: ['llmProviders'] },
    });
    expect(JSON.stringify(audit.emitAtomic.mock.calls)).not.toContain(secretApiKey);
  });

  it('records the changed app config keys only', async () => {
    const { service, audit } = createAuditedService({
      appConfig: { vercelToken: 'old-token', deployProvider: 'vercel' },
    });

    await service.updateAppConfig({
      section: 'engine',
      patch: { vercelToken: 'new-token', deployProvider: 'vercel' },
    } as never);

    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'admin.setting.update-app-config',
      resourceId: instanceResourceId,
      params: { changedKeys: ['vercelToken'] },
    });
    expect(JSON.stringify(audit.emitAtomic.mock.calls)).not.toContain('new-token');
  });

  it('records the changed SMTP fields of a mail transport without the password', async () => {
    const { service, audit } = createAuditedService({
      notifyMailTransportConfig: {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'mailer', pass: 'old-pass' },
      },
    });

    await service.setMailTransportConfig({
      name: 'notifyMailTransportConfig',
      transportConfig: {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        sender: 'noreply@example.com',
        senderName: 'Teable',
        auth: { user: 'mailer', pass: secretApiKey },
      },
    } as never);

    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'admin.setting.update-mail-transport',
      resourceId: instanceResourceId,
      params: {
        transporter: 'notifyMailTransportConfig',
        changedKeys: ['auth.pass', 'sender', 'senderName'],
      },
    });
    expect(JSON.stringify(audit.emitAtomic.mock.calls)).not.toContain(secretApiKey);
  });

  it('records a logo upload as its own row, not as a settings update', async () => {
    const { service, settingService, audit } = createAuditedService({});

    await service.uploadLogo({
      path: '/tmp/logo.png',
      mimetype: 'image/png',
      size: 1024,
    } as never);

    expect(settingService.updateSetting).toHaveBeenCalledWith({
      brandLogo: expect.any(String),
    });
    expect(audit.emitAtomic).toHaveBeenCalledTimes(1);
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'admin.setting.update-logo',
      resourceId: instanceResourceId,
      params: { mimetype: 'image/png', size: 1024 },
    });
  });
});

describe('SettingOpenApiService.testLLM image generation', () => {
  const service = Object.create(SettingOpenApiService.prototype) as SettingOpenApiService;
  let getTestFileBufferMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // testLLM vets the provider host before calling it; keep that off the real DNS
    vi.spyOn(dnsPromises, 'lookup').mockResolvedValue([
      { address: '104.18.6.192', family: 4 },
    ] as never);
    getTestFileBufferMock = vi.fn().mockResolvedValue(testImageBuffer);
    (
      service as unknown as {
        getTestFileBuffer: typeof getTestFileBufferMock;
      }
    ).getTestFileBuffer = getTestFileBufferMock;
    vi.mocked(aiGenerateImage).mockResolvedValue({
      image: { mediaType: 'image/png', uint8Array: new Uint8Array([1]) },
      images: [{ mediaType: 'image/png', uint8Array: new Uint8Array([1]) }],
      warnings: [],
      responses: [],
      providerMetadata: {},
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    } as never);
  });

  it('uses the catalog default size when testing GPT image text-to-image generation', async () => {
    const result = await service.testLLM({
      type: LLMProviderType.OPENAI,
      name: providerName,
      apiKey,
      baseUrl: openAIBaseUrl,
      models: gptImage2Model,
      modelKey: gptImage2ModelKey,
      testImageGeneration: true,
    });

    expect(result.success).toBe(true);
    expect(aiGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'A simple test: draw a small red circle',
        n: 1,
        size: '1024x1024',
      })
    );
  });

  it('infers image generation testing from catalog when testImageGeneration is omitted', async () => {
    const result = await service.testLLM({
      type: LLMProviderType.OPENAI,
      name: providerName,
      apiKey,
      baseUrl: openAIBaseUrl,
      models: gptImage2Model,
      modelKey: gptImage2ModelKey,
    });

    expect(result.success).toBe(true);
    expect(aiGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'A simple test: draw a small red circle',
        n: 1,
        size: '1024x1024',
      })
    );
  });

  it('uses prompt images when testing GPT image image-to-image generation', async () => {
    const result = await service.testLLM({
      type: LLMProviderType.OPENAI,
      name: providerName,
      apiKey,
      baseUrl: openAIBaseUrl,
      models: gptImage2Model,
      modelKey: gptImage2ModelKey,
      testImageGeneration: true,
      testImageToImage: true,
    });

    expect(result.success).toBe(true);
    expect(aiGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: {
          text: 'Create a very simple variation of this image.',
          images: [testImageBuffer],
        },
        n: 1,
        size: '1024x1024',
      })
    );
    expect(getTestFileBufferMock).toHaveBeenCalledWith('static/test/test-image.png');
    expect(vi.mocked(aiGenerateImage).mock.calls[0][0]).not.toHaveProperty(
      'providerOptions.openai.image'
    );
  });
});

describe('SettingOpenApiService.testLLM upstream errors', () => {
  const service = Object.create(SettingOpenApiService.prototype) as SettingOpenApiService;
  const ro = {
    type: LLMProviderType.OPENAI,
    name: providerName,
    apiKey,
    baseUrl: openAIBaseUrl,
    models: 'gpt-4o-mini',
  };
  const socketError = 'connect ECONNREFUSED 10.0.0.5:6379';

  const failureMessage = async (asInstanceAdmin?: boolean) => {
    try {
      await service.testLLM(ro, { asInstanceAdmin });
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('testLLM should have failed');
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dnsPromises, 'lookup').mockResolvedValue([
      { address: '104.18.6.192', family: 4 },
    ] as never);
    (service as unknown as { logger: unknown }).logger = { warn: vi.fn(), error: vi.fn() };
  });

  it('hides socket errors from callers other than instance admins', async () => {
    vi.mocked(aiGenerateText).mockRejectedValue(new Error(socketError));

    const message = await failureMessage();
    expect(message).not.toContain('ECONNREFUSED');
    expect(message).toContain('Could not get a valid response from the provider');
    expect(await failureMessage(true)).toContain(socketError);
  });

  it('keeps only the status a provider answered with', async () => {
    vi.mocked(aiGenerateText).mockRejectedValue(
      new APICallError({
        message: 'internal service body',
        url: `${openAIBaseUrl}/chat/completions`,
        requestBodyValues: {},
        statusCode: 401,
        responseBody: 'internal service body',
      })
    );

    const message = await failureMessage();
    expect(message).toContain('The provider responded with HTTP 401');
    expect(message).not.toContain('internal service body');
  });
});

/**
 * The instance admin's key tests take a base URL from the request and hand the
 * upstream's answer back, so they may reach the private network (a LAN or VPC
 * peer) but never the cloud-metadata addresses (pentest SSRF-02/03).
 */
describe('SettingOpenApiService.testApiKey reach', () => {
  const service = Object.create(SettingOpenApiService.prototype) as SettingOpenApiService;
  let server: Server;
  let baseUrl: string;
  let requests: string[];

  beforeEach(
    () =>
      new Promise<void>((resolve) => {
        process.env.NEXT_BUILD_ENV_EDITION = 'CLOUD';
        (service as unknown as { logger: unknown }).logger = { warn: vi.fn(), error: vi.fn() };
        requests = [];
        server = createServer((req, res) => {
          requests.push(`${req.method} ${req.url} ${req.headers['content-type'] ?? ''}`);
          // eslint-disable-next-line @typescript-eslint/naming-convention
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ text: '' }));
        });
        server.listen(0, '127.0.0.1', () => {
          baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
          resolve();
        });
      })
  );

  afterEach(async () => {
    delete process.env.NEXT_BUILD_ENV_EDITION;
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('refuses a Vercel base URL on a cloud-metadata address', async () => {
    const result = await service.testApiKey({
      type: 'vercel',
      apiKey: 'token',
      baseUrl: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/role#',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/cloud metadata/);
  });

  it('still reaches a Vercel base URL on the private network', async () => {
    const result = await service.testApiKey({ type: 'vercel', apiKey: 'token', baseUrl });
    expect(result).toEqual({ success: true });
    expect(requests).toEqual(['GET /v1/v2/user ']);
  });

  it('sends the transcription test through the guarded fetch and still reaches the server', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await service.testApiKey({
      type: 'realtimeTranscription',
      apiKey: 'key',
      baseUrl,
    });
    expect(result).toEqual({ success: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/^POST \/v1\/audio\/transcriptions multipart\/form-data/);
    expect(fetchSpy.mock.calls[0]?.[1]).toHaveProperty('dispatcher');
  });
});
