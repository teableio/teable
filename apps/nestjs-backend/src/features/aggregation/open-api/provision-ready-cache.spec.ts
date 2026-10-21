import { afterEach, describe, expect, it, vi } from 'vitest';
import { provisionReadyCache } from './provision-ready-cache';

afterEach(() => vi.useRealTimers());
const pending = new Error('pending');
const fixture = () => ({
  getCached: vi.fn<() => Promise<{ data: number } | null>>().mockResolvedValue(null),
  wait: vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined),
  loadWithoutWait: vi.fn<() => Promise<number>>().mockResolvedValue(42),
  isPending: (error: unknown) => error === pending,
  budgetMs: 1000,
});

describe('provisionReadyCache', () => {
  it('does not probe or load on a cache hit', async () => {
    const f = fixture();
    f.getCached.mockResolvedValue({ data: 9 });
    expect(await provisionReadyCache(f)).toBe(9);
    expect(f.wait).not.toHaveBeenCalled();
    expect(f.loadWithoutWait).not.toHaveBeenCalled();
  });
  it('uses the original deadline after a loader releases its lock on pending', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.loadWithoutWait.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 600);
      throw pending;
    });
    expect(await provisionReadyCache(f)).toBe(42);
    expect(f.wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 400]);
  });
  it('never treats lock acquisition busy as readiness', async () => {
    const f = fixture();
    const busy = new Error('Query is busy');
    f.loadWithoutWait.mockRejectedValue(busy);
    await expect(provisionReadyCache(f)).rejects.toBe(busy);
    expect(f.wait).toHaveBeenCalledTimes(1);
  });
  it('100 pending misses never enter the lock/loader', async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.wait.mockImplementation(async () => {
      await gate;
      throw pending;
    });
    const requests = Array.from({ length: 100 }, () => provisionReadyCache(f).catch((e) => e));
    await Promise.resolve();
    expect(f.wait).toHaveBeenCalledTimes(100);
    expect(f.loadWithoutWait).not.toHaveBeenCalled();
    release();
    expect(await Promise.all(requests)).toEqual(Array(100).fill(pending));
  });
});
