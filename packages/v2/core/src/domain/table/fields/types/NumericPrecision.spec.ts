import { describe, expect, it } from 'vitest';

import { NumericPrecision } from './NumericPrecision';

describe('NumericPrecision', () => {
  it('accepts valid precision values', () => {
    expect(NumericPrecision.create(0).isOk()).toBe(true);
    expect(NumericPrecision.create(5).isOk()).toBe(true);
  });

  it('rejects invalid precision values', () => {
    expect(NumericPrecision.create(-1).isErr()).toBe(true);
    expect(NumericPrecision.create(6).isErr()).toBe(true);
    expect(NumericPrecision.create('2').isErr()).toBe(true);
  });

  it('provides default and integer helpers', () => {
    expect(NumericPrecision.default().toNumber()).toBe(2);
    expect(NumericPrecision.integer().toNumber()).toBe(0);
  });

  it('compares precision values by value', () => {
    const left = NumericPrecision.create(2);
    const right = NumericPrecision.create(2);
    expect([left, right].every((r) => r.isOk())).toBe(true);
    if (left.isErr() || right.isErr()) return;
    expect(left.value.equals(right.value)).toBe(true);
  });
});
