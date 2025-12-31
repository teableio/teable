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
    const leftValue = left._unsafeUnwrap();
    const rightValue = right._unsafeUnwrap();
    expect(leftValue.equals(rightValue)).toBe(true);
    expect(leftValue.type()).toBe('url');
    expect(leftValue.toDto()).toEqual({ type: 'url' });
  });
});
