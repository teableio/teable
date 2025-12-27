import { describe, expect, it } from 'vitest';

import { MultiNumberDisplayType, NumberShowAs, SingleNumberDisplayType } from './NumberShowAs';

describe('NumberShowAs', () => {
  it('accepts single and multi showAs shapes', () => {
    NumberShowAs.create({
      type: SingleNumberDisplayType.Bar,
      color: 'blue',
      showValue: true,
      maxValue: 100,
    })._unsafeUnwrap();

    NumberShowAs.create({
      type: MultiNumberDisplayType.Line,
      color: 'green',
    })._unsafeUnwrap();
  });

  it('rejects invalid showAs shape', () => {
    NumberShowAs.create({ type: 'pie', color: 'blue' })._unsafeUnwrapErr();
  });

  it('compares showAs values and maps to dto', () => {
    const single = NumberShowAs.create({
      type: SingleNumberDisplayType.Bar,
      color: 'blue',
      showValue: true,
      maxValue: 100,
    });
    const multi = NumberShowAs.create({
      type: MultiNumberDisplayType.Line,
      color: 'green',
    });
    [single, multi].forEach((r) => r._unsafeUnwrap());
    single._unsafeUnwrap();
    multi._unsafeUnwrap();
    expect(single.value.equals(single.value)).toBe(true);
    expect(multi.value.equals(multi.value)).toBe(true);
    expect(single.value.toDto()).toEqual({
      type: SingleNumberDisplayType.Bar,
      color: 'blue',
      showValue: true,
      maxValue: 100,
    });
  });
});
