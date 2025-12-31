import { describe, expect, it } from 'vitest';

import { NumericPrecision } from './NumericPrecision';

describe('NumericPrecision', () => {
  it('accepts valid precision values', () => {
    NumericPrecision.create(0)._unsafeUnwrap();
    NumericPrecision.create(5)._unsafeUnwrap();
  });

  it('rejects invalid precision values', () => {
    NumericPrecision.create(-1)._unsafeUnwrapErr();
    NumericPrecision.create(6)._unsafeUnwrapErr();
    NumericPrecision.create('2')._unsafeUnwrapErr();
  });

  it('provides default and integer helpers', () => {
    expect(NumericPrecision.default().toNumber()).toBe(2);
    expect(NumericPrecision.integer().toNumber()).toBe(0);
  });

  it('compares precision values by value', () => {
    const left = NumericPrecision.create(2);
    const right = NumericPrecision.create(2);
    const leftValue = left._unsafeUnwrap();
    const rightValue = right._unsafeUnwrap();
    expect(leftValue.equals(rightValue)).toBe(true);
  });
});
