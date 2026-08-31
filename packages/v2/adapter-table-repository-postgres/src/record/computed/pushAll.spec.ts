import { describe, expect, it } from 'vitest';

import { pushAll } from './pushAll';

describe('pushAll', () => {
  it('appends items onto the target array', () => {
    const target = [1];
    expect(pushAll(target, [2, 3])).toBe(target);
    expect(target).toEqual([1, 2, 3]);
  });

  it('appends large arrays without overflowing the call stack', () => {
    const size = 200_000;
    const target: number[] = [];
    const items = Array.from({ length: size }, (_, index) => index);

    expect(() => pushAll(target, items)).not.toThrow();
    expect(target).toHaveLength(size);
    expect(target[0]).toBe(0);
    expect(target[size - 1]).toBe(size - 1);
  });
});
