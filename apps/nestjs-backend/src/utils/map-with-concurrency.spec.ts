import { describe, expect, it, vi } from 'vitest';

import { mapWithConcurrency } from './map-with-concurrency';

describe('mapWithConcurrency', () => {
  it('bounds concurrent work and preserves input order', async () => {
    let active = 0;
    let peakActive = 0;
    const releases: Array<() => void> = [];
    const mapper = vi.fn(async (value: number) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return value * 10;
    });

    const resultPromise = mapWithConcurrency([1, 2, 3], 2, mapper);
    await vi.waitFor(() => expect(mapper).toHaveBeenCalledTimes(2));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(mapper).toHaveBeenCalledTimes(3));
    releases.splice(0).forEach((release) => release());

    await expect(resultPromise).resolves.toEqual([10, 20, 30]);
    expect(peakActive).toBe(2);
  });
});
