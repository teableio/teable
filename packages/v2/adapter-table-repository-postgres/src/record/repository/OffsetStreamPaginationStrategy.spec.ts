import { describe, expect, it } from 'vitest';

import { OffsetStreamPaginationStrategy } from './OffsetStreamPaginationStrategy';

describe('OffsetStreamPaginationStrategy', () => {
  it('accepts empty and offset pagination', () => {
    const strategy = new OffsetStreamPaginationStrategy();

    expect(strategy.accepts(undefined)).toBe(true);
    expect(strategy.accepts({ offset: 10, limit: 100 })).toBe(true);
    expect(strategy.accepts({ cursor: '10', limit: 100 })).toBe(false);
  });

  it('calculates next page using startOffset + yieldedCount', () => {
    const strategy = new OffsetStreamPaginationStrategy();

    const page = strategy.next({
      pagination: { offset: 100, limit: 1000 },
      batchSize: 500,
      yieldedCount: 250,
    });

    expect(page).toEqual({
      type: 'offset',
      offset: 350,
      limit: 500,
    });
  });

  it('uses zero offset and batch size when pagination is undefined', () => {
    const strategy = new OffsetStreamPaginationStrategy();

    const page = strategy.next({
      batchSize: 128,
      yieldedCount: 0,
    });

    expect(page).toEqual({
      type: 'offset',
      offset: 0,
      limit: 128,
    });
  });

  it('caps page size by remaining limit', () => {
    const strategy = new OffsetStreamPaginationStrategy();

    const page = strategy.next({
      pagination: { offset: 0, limit: 520 },
      batchSize: 500,
      yieldedCount: 500,
    });

    expect(page).toEqual({
      type: 'offset',
      offset: 500,
      limit: 20,
    });
  });

  it('returns null when stream already reached maxLimit', () => {
    const strategy = new OffsetStreamPaginationStrategy();

    const page = strategy.next({
      pagination: { offset: 0, limit: 1000 },
      batchSize: 500,
      yieldedCount: 1000,
    });

    expect(page).toBeNull();
  });
});
