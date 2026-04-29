import axios from 'axios';
import { SettingOpenApiService } from './setting-open-api.service';

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
