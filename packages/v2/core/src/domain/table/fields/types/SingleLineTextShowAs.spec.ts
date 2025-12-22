import { describe, expect, it } from 'vitest';

import { SingleLineTextShowAs } from './SingleLineTextShowAs';

describe('SingleLineTextShowAs', () => {
  it('accepts supported showAs types', () => {
    expect(SingleLineTextShowAs.create({ type: 'url' }).isOk()).toBe(true);
    expect(SingleLineTextShowAs.create({ type: 'email' }).isOk()).toBe(true);
    expect(SingleLineTextShowAs.create({ type: 'phone' }).isOk()).toBe(true);
  });

  it('rejects unsupported showAs types', () => {
    expect(SingleLineTextShowAs.create({ type: 'link' }).isErr()).toBe(true);
  });

  it('compares showAs values and maps to dto', () => {
    const left = SingleLineTextShowAs.create({ type: 'url' });
    const right = SingleLineTextShowAs.create({ type: 'url' });
    expect([left, right].every((r) => r.isOk())).toBe(true);
    if (left.isErr() || right.isErr()) return;
    expect(left.value.equals(right.value)).toBe(true);
    expect(left.value.type()).toBe('url');
    expect(left.value.toDto()).toEqual({ type: 'url' });
  });
});
