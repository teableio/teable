import { LLMProviderType } from '@teable/openapi';
import { generateImage as aiGenerateImage } from 'ai';
import axios from 'axios';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingOpenApiService } from './setting-open-api.service';

vi.mock('ai', () => ({
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
      undefined as never
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
});

describe('SettingOpenApiService.testLLM image generation', () => {
  const service = Object.create(SettingOpenApiService.prototype) as SettingOpenApiService;
  let getTestFileBufferMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
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
