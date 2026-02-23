import { describe, expect, it } from 'vitest';

import { CursorStreamPaginationStrategy } from './CursorStreamPaginationStrategy';

describe('CursorStreamPaginationStrategy', () => {
  it('accepts cursor pagination only', () => {
    const strategy = new CursorStreamPaginationStrategy();

    expect(strategy.accepts(undefined)).toBe(false);
    expect(strategy.accepts({ offset: 10, limit: 100 })).toBe(false);
    expect(strategy.accepts({ cursor: '10', limit: 100 })).toBe(true);
  });

  it('calculates next page from cursor + yieldedCount', () => {
    const strategy = new CursorStreamPaginationStrategy();

    const page = strategy.next({
      pagination: { cursor: '100', limit: 1000 },
      batchSize: 500,
      yieldedCount: 250,
    });

    expect(page).toEqual({
      type: 'cursor',
      cursor: '100',
      limit: 500,
    });
  });

  it('falls back to zero offset when cursor is invalid', () => {
    const strategy = new CursorStreamPaginationStrategy();

    const page = strategy.next({
      pagination: { cursor: 'invalid', limit: 200 },
      batchSize: 500,
      yieldedCount: 0,
    });

    expect(page).toEqual({
      type: 'cursor',
      cursor: 'invalid',
      limit: 200,
    });
  });

  it('uses last cursor from previous page and caps by remaining limit', () => {
    const strategy = new CursorStreamPaginationStrategy();

    const page = strategy.next({
      pagination: { cursor: '10.8', limit: 12 },
      batchSize: 5,
      yieldedCount: 10,
      lastCursor: '15',
    });

    expect(page).toEqual({
      type: 'cursor',
      cursor: '15',
      limit: 2,
    });
  });

  it('returns null when yielded count already reaches max limit', () => {
    const strategy = new CursorStreamPaginationStrategy();

    const page = strategy.next({
      pagination: { cursor: '3', limit: 3 },
      batchSize: 10,
      yieldedCount: 3,
    });

    expect(page).toBeNull();
  });
});
