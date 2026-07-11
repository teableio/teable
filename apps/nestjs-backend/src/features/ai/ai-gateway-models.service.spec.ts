import type { IGatewayApiModelRaw } from '@teable/openapi';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformanceCacheService } from '../../performance-cache';
import { AI_GATEWAY_MODELS_CACHE_KEY, AiGatewayModelsService } from './ai-gateway-models.service';

// Passthrough wrap simulates a cache miss (or no Redis configured): the
// fetcher runs. A resolved wrap simulates a Redis hit: the fetcher is skipped.
function makeService(cachedModels?: unknown): {
  service: AiGatewayModelsService;
  cacheService: PerformanceCacheService;
} {
  const cacheService = {
    wrap:
      cachedModels === undefined
        ? vi.fn((_key: string, fn: () => Promise<unknown>) => fn())
        : vi.fn().mockResolvedValue(cachedModels),
  } as unknown as PerformanceCacheService;
  return { service: new AiGatewayModelsService(cacheService), cacheService };
}

function mockLiveModels(models: IGatewayApiModelRaw[]) {
  vi.mocked(axios.get).mockResolvedValue({ data: { data: models } });
}

describe('AiGatewayModelsService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(axios, 'get');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    mockLiveModels([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches from the gateway on cache miss and converts to camelCase', async () => {
    /* eslint-disable @typescript-eslint/naming-convention */
    mockLiveModels([{ id: 'anthropic/claude-test', name: 'Claude Test', max_tokens: 32_000 }]);
    /* eslint-enable @typescript-eslint/naming-convention */
    const { service, cacheService } = makeService();

    const models = await service.getGatewayModels();

    expect(models).toEqual([
      expect.objectContaining({ id: 'anthropic/claude-test', maxTokens: 32_000 }),
    ]);
    expect(cacheService.wrap).toHaveBeenCalledWith(
      AI_GATEWAY_MODELS_CACHE_KEY,
      expect.any(Function),
      {
        ttl: 60 * 60,
      }
    );
  });

  it('serves the cached value without fetching', async () => {
    const cached = [{ id: 'anthropic/claude-test' }];
    const { service } = makeService(cached);

    await expect(service.getGatewayModels()).resolves.toEqual(cached);
    expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
  });

  it('returns an empty list when the fetch fails, without rejecting', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('gateway unreachable'));
    const { service } = makeService();

    await expect(service.getGatewayModels()).resolves.toEqual([]);
  });

  it('backs off after a failed fetch, doubling the retry window per consecutive failure', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('gateway unreachable'));
    const { service } = makeService();

    await service.getGatewayModels(); // 1st failure
    expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(1);

    // Within the initial 60s window: no retry.
    vi.setSystemTime(new Date('2026-01-01T00:00:59Z'));
    await service.getGatewayModels();
    expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(1);

    // Past 60s: retries (2nd failure), doubling the window to 120s.
    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    await service.getGatewayModels();
    expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(2);

    // 61s after the 2nd failure, inside the doubled window: still no retry.
    vi.setSystemTime(new Date('2026-01-01T00:02:02Z'));
    await service.getGatewayModels();
    expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(2);

    // 121s after the 2nd failure: retries again.
    vi.setSystemTime(new Date('2026-01-01T00:03:02Z'));
    await service.getGatewayModels();
    expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(3);
  });
});
