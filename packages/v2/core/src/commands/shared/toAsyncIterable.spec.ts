import { describe, expect, it } from 'vitest';

import { isAsyncIterable, toAsyncIterable } from './toAsyncIterable';

describe('toAsyncIterable', () => {
  it('re-yields an async iterable as-is', async () => {
    async function* source() {
      yield 1;
      yield 2;
    }

    const asyncSource = source();
    expect(isAsyncIterable(asyncSource)).toBe(true);

    const values: number[] = [];
    for await (const value of toAsyncIterable(asyncSource)) {
      values.push(value);
    }
    expect(values).toEqual([1, 2]);
  });

  it('wraps a sync iterable without materializing it first', async () => {
    function* source() {
      yield 'a';
      yield 'b';
    }

    const values: string[] = [];
    for await (const value of toAsyncIterable(source())) {
      values.push(value);
    }
    expect(values).toEqual(['a', 'b']);
  });
});
