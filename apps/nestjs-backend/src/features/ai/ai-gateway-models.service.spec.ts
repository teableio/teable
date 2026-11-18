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

  it('keeps a loaded list in memory for 10 minutes instead of re-reading the cache', async () => {
    const cached = [{ id: 'anthropic/claude-test' }];
    const { service, cacheService } = makeService(cached);

    await service.getGatewayModels();
    vi.setSystemTime(new Date('2026-01-01T00:09:59Z'));
    await expect(service.getGatewayModels()).resolves.toEqual(cached);
    expect(cacheService.wrap).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-01-01T00:10:01Z'));
    await service.getGatewayModels();
    expect(cacheService.wrap).toHaveBeenCalledTimes(2);
  });

  it('serves the last list while a background load refreshes it', async () => {
    const first = [{ id: 'anthropic/claude-test' }];
    const second = [{ id: 'anthropic/claude-test-2' }];
    const wrap = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const service = new AiGatewayModelsService({ wrap } as unknown as PerformanceCacheService);

    await service.getGatewayModels();
    vi.setSystemTime(new Date('2026-01-01T00:10:01Z'));
    await expect(service.getGatewayModels()).resolves.toEqual(first);
    await vi.waitFor(async () => expect(await service.getGatewayModels()).toEqual(second));
    expect(wrap).toHaveBeenCalledTimes(2);
  });

  it('shares one load between concurrent callers', async () => {
    const cached = [{ id: 'anthropic/claude-test' }];
    const { service, cacheService } = makeService(cached);

    const results = await Promise.all([service.getGatewayModels(), service.getGatewayModels()]);

    expect(results).toEqual([cached, cached]);
    expect(cacheService.wrap).toHaveBeenCalledTimes(1);
  });

  it('waits for the refresh once an expired list is past the grace period', async () => {
    const first = [{ id: 'anthropic/claude-test' }];
    const second = [{ id: 'anthropic/claude-test-2' }];
    const wrap = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const service = new AiGatewayModelsService({ wrap } as unknown as PerformanceCacheService);

    await service.getGatewayModels();
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z')); // idle for a day
    await expect(service.getGatewayModels()).resolves.toEqual(second);
  });

  it('falls back to the old list past the grace period when the refresh fails', async () => {
    const first = [{ id: 'anthropic/claude-test' }];
    const wrap = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('Query is busy'));
    const service = new AiGatewayModelsService({ wrap } as unknown as PerformanceCacheService);

    await service.getGatewayModels();
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    await expect(service.getGatewayModels()).resolves.toEqual(first);
  });

  it('does not hand a failed shared load to callers that joined it; they share one retry', async () => {
    const cached = [{ id: 'anthropic/claude-test' }];
    let failFirst: (error: Error) => void = () => undefined;
    const wrap = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failFirst = reject;
          })
      )
      .mockResolvedValue(cached);
    const service = new AiGatewayModelsService({ wrap } as unknown as PerformanceCacheService);

    const first = service.getGatewayModels();
    const joined = Array.from({ length: 5 }, () => service.getGatewayModels());
    failFirst(new Error('Query is busy'));

    await expect(first).resolves.toEqual([]);
    await expect(Promise.all(joined)).resolves.toEqual(Array(5).fill(cached));
    expect(wrap).toHaveBeenCalledTimes(2);
  });

  it('lets calls that arrive during the retry join it instead of starting another load', async () => {
    const cached = [{ id: 'anthropic/claude-test' }];
    let failFirst: (error: Error) => void = () => undefined;
    let finishRetry: (models: unknown) => void = () => undefined;
    const wrap = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failFirst = reject;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRetry = resolve;
          })
      );
    const service = new AiGatewayModelsService({ wrap } as unknown as PerformanceCacheService);

    const first = service.getGatewayModels();
    const joined = service.getGatewayModels();
    failFirst(new Error('Query is busy'));
    await vi.waitFor(() => expect(wrap).toHaveBeenCalledTimes(2)); // the retry is running
    const late = service.getGatewayModels();
    finishRetry(cached);

    await expect(first).resolves.toEqual([]);
    await expect(Promise.all([joined, late])).resolves.toEqual([cached, cached]);
    expect(wrap).toHaveBeenCalledTimes(2);
  });

  it('serves the old list during a backoff without restarting its grace period', async () => {
    /* eslint-disable @typescript-eslint/naming-convention */
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: { data: [{ id: 'anthropic/claude-old' }] } })
      .mockRejectedValueOnce(new Error('gateway unreachable'))
      .mockResolvedValueOnce({ data: { data: [{ id: 'anthropic/claude-new' }] } });
    /* eslint-enable @typescript-eslint/naming-convention */
    const { service } = makeService(); // no Redis: wrap runs the fetcher

    await service.getGatewayModels();
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z')); // idle for a day; the refresh fails
    const ids = async () => (await service.getGatewayModels()).map((m) => m.id);
    await expect(ids()).resolves.toEqual(['anthropic/claude-old']);
    vi.setSystemTime(new Date('2026-01-02T00:00:01Z')); // backing off: old list, no fetch
    await expect(ids()).resolves.toEqual(['anthropic/claude-old']);
    expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date('2026-01-02T00:01:02Z')); // gateway is back
    await expect(ids()).resolves.toEqual(['anthropic/claude-new']);
  });

  it('does not cache the result of a cache or lock error', async () => {
    const wrap = vi.fn().mockRejectedValue(new Error('Query is busy'));
    const service = new AiGatewayModelsService({ wrap } as unknown as PerformanceCacheService);

    await expect(service.getGatewayModels()).resolves.toEqual([]);
    await expect(service.getGatewayModels()).resolves.toEqual([]);
    expect(wrap).toHaveBeenCalledTimes(2);
  });

  it('picks up a list another instance cached while this one backs off, within 30s', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('gateway unreachable'));
    const shared = [{ id: 'anthropic/claude-test' }];
    let sharedCache: unknown;
    const wrap = vi.fn((_key: string, fn: () => Promise<unknown>) =>
      sharedCache !== undefined ? Promise.resolve(sharedCache) : fn()
    );
    const service = new AiGatewayModelsService({ wrap } as unknown as PerformanceCacheService);

    await service.getGatewayModels(); // fetch fails, backoff starts
    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'));
    await expect(service.getGatewayModels()).resolves.toEqual([]); // backing off: [] cached briefly

    sharedCache = shared; // another instance fetched and cached the list
    vi.setSystemTime(new Date('2026-01-01T00:00:36Z'));
    await expect(service.getGatewayModels()).resolves.toEqual(shared);
  });

  it('returns a frozen list so shared models cannot be changed in place', async () => {
    const { service } = makeService([{ id: 'anthropic/claude-test', pricing: { input: '1' } }]);

    const models = await service.getGatewayModels();

    expect(Object.isFrozen(models)).toBe(true);
    expect(Object.isFrozen(models[0])).toBe(true);
    expect(Object.isFrozen(models[0].pricing)).toBe(true);
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
