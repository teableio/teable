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
    const singleValue = single._unsafeUnwrap();
    const multiValue = multi._unsafeUnwrap();
    expect(singleValue.equals(singleValue)).toBe(true);
    expect(multiValue.equals(multiValue)).toBe(true);
    expect(singleValue.toDto()).toEqual({
      type: SingleNumberDisplayType.Bar,
      color: 'blue',
      showValue: true,
      maxValue: 100,
    });
  });
});
