import ms from 'ms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoalesceMode } from './coalesce.service';
import { createCoalesceBackend } from './coalesce.spec-mocks';

const SCOPE = 'test';
const fixed = { mode: CoalesceMode.Fixed, windowMs: 1000 };
const quiet = { mode: CoalesceMode.Quiet, windowMs: 1000 };

function harness() {
  const backend = createCoalesceBackend();
  const service = backend.createService();
  const flushed: string[][] = [];
  const flush = vi.fn(async (_key: string, items: string[]) => {
    flushed.push(items);
  });
  service.onFlush(SCOPE, flush);
  return { service, flush, flushed, backend };
}

describe('CoalesceService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets the first item through and buffers the rest until a fixed window closes', async () => {
    const { service, flushed } = harness();

    expect(await service.add(SCOPE, 'k', 'a', fixed)).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(await service.add(SCOPE, 'k', 'b', fixed)).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(await service.add(SCOPE, 'k', 'c', fixed)).toBe(false);
    expect(flushed).toEqual([]);

    // fixed: the window closes 1000ms after the first item, however late the others came
    await vi.advanceTimersByTimeAsync(200);
    expect(flushed).toEqual([['b', 'c']]);
    expect(await service.add(SCOPE, 'k', 'd', fixed)).toBe(true);
  });

  it('holds a quiet window open while items keep coming', async () => {
    const { service, flushed } = harness();

    await service.add(SCOPE, 'k', 'a', quiet);
    for (const item of ['b', 'c', 'd']) {
      await vi.advanceTimersByTimeAsync(800);
      await service.add(SCOPE, 'k', item, quiet);
    }
    expect(flushed).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(flushed).toEqual([['b', 'c', 'd']]);
  });

  it('flushes nothing for a window nobody wrote into', async () => {
    const { service, flush } = harness();

    await service.add(SCOPE, 'k', 'a', fixed);
    await vi.advanceTimersByTimeAsync(5000);

    expect(flush).not.toHaveBeenCalled();
  });

  it('keeps separate windows per key', async () => {
    const { service } = harness();

    expect(await service.add(SCOPE, 'k1', 'a', fixed)).toBe(true);
    expect(await service.add(SCOPE, 'k2', 'b', fixed)).toBe(true);
  });

  it('keeps the buffer when a flush fails, and its retry sends what joined meanwhile', async () => {
    const { service, flush, flushed, backend } = harness();
    flush.mockRejectedValueOnce(new Error('smtp down'));

    await service.add(SCOPE, 'k', 'a', fixed);
    await service.add(SCOPE, 'k', 'b', fixed);
    await vi.advanceTimersByTimeAsync(1000);
    expect(flushed).toEqual([]);

    // the window has closed but its batch is still waiting: the new item joins it and waits
    // for the retry, rather than booking a flush of its own
    expect(await service.add(SCOPE, 'k', 'c', fixed)).toBe(false);
    expect(backend.bookings).toBe(1);
    await vi.advanceTimersByTimeAsync(ms('1m'));
    expect(flushed).toEqual([['b', 'c']]);
  });

  it('books the batch a new flush with the next item once its flush gave up', async () => {
    const { service, flush, flushed, backend } = harness();
    flush
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockRejectedValueOnce(new Error('smtp down'));

    await service.add(SCOPE, 'k', 'a', fixed);
    await service.add(SCOPE, 'k', 'b', fixed);
    // the window closes, then the flush fails at once, a minute later and two minutes after that
    await vi.advanceTimersByTimeAsync(ms('4m'));
    expect(flush).toHaveBeenCalledTimes(3);

    // the next item books the batch one flush; the one after joins it
    expect(await service.add(SCOPE, 'k', 'c', fixed)).toBe(false);
    expect(await service.add(SCOPE, 'k', 'd', fixed)).toBe(false);
    expect(backend.bookings).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toEqual([['b', 'c', 'd']]);
  });

  it('recovers a batch whose flush was lost', async () => {
    const { service, flushed } = harness();

    await service.add(SCOPE, 'k', 'a', quiet);
    await service.add(SCOPE, 'k', 'b', quiet);
    vi.clearAllTimers();
    // past the window and its flush's retries
    await vi.advanceTimersByTimeAsync(ms('11m'));

    expect(await service.add(SCOPE, 'k', 'c', quiet)).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(flushed).toEqual([['b', 'c']]);
  });

  it('stores a buffer as the scope folds it', async () => {
    const { service, flushed } = harness();
    service.onFlush(
      SCOPE,
      async (_key, items: string[]) => void flushed.push(items),
      (items: string[]) => [items.join('')]
    );

    await service.add(SCOPE, 'k', 'a', fixed);
    await service.add(SCOPE, 'k', 'b', fixed);
    await service.add(SCOPE, 'k', 'c', fixed);
    await vi.advanceTimersByTimeAsync(1000);

    expect(flushed).toEqual([['bc']]);
  });

  it('fails only the item whose flush could not be booked', async () => {
    const { service, flushed, backend } = harness();

    await service.add(SCOPE, 'k', 'a', fixed);
    backend.failNextBooking();
    await expect(service.add(SCOPE, 'k', 'b', fixed)).rejects.toThrow('queue unreachable');
    expect(await service.add(SCOPE, 'k', 'c', fixed)).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);

    expect(flushed).toEqual([['c']]);
  });

  it('shares one window across pods', async () => {
    const { service, flushed, backend } = harness();
    const otherPod = backend.createService();
    otherPod.onFlush(SCOPE, async (_key, items: string[]) => void flushed.push(items));

    expect(await service.add(SCOPE, 'k', 'a', fixed)).toBe(true);
    expect(await otherPod.add(SCOPE, 'k', 'b', fixed)).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);

    expect(flushed).toEqual([['b']]);
  });
});
