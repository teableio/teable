import { describe, expect, it } from 'vitest';

import { SingleLineTextShowAs } from './SingleLineTextShowAs';

describe('SingleLineTextShowAs', () => {
  it('accepts supported showAs types', () => {
    SingleLineTextShowAs.create({ type: 'url' })._unsafeUnwrap();
    SingleLineTextShowAs.create({ type: 'email' })._unsafeUnwrap();
    SingleLineTextShowAs.create({ type: 'phone' })._unsafeUnwrap();
  });

  it('rejects unsupported showAs types', () => {
    SingleLineTextShowAs.create({ type: 'link' })._unsafeUnwrapErr();
  });

  it('compares showAs values and maps to dto', () => {
    const left = SingleLineTextShowAs.create({ type: 'url' });
    const right = SingleLineTextShowAs.create({ type: 'url' });
    [left, right].forEach((r) => r._unsafeUnwrap());
    left._unsafeUnwrap();
    right._unsafeUnwrap();
    expect(left.value.equals(right.value)).toBe(true);
    expect(left.value.type()).toBe('url');
    expect(left.value.toDto()).toEqual({ type: 'url' });
  });
});
