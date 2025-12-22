import { describe, expect, it } from 'vitest';

import { MultiNumberDisplayType, NumberShowAs, SingleNumberDisplayType } from './NumberShowAs';

describe('NumberShowAs', () => {
  it('accepts single and multi showAs shapes', () => {
    expect(
      NumberShowAs.create({
        type: SingleNumberDisplayType.Bar,
        color: 'blue',
        showValue: true,
        maxValue: 100,
      }).isOk()
    ).toBe(true);

    expect(
      NumberShowAs.create({
        type: MultiNumberDisplayType.Line,
        color: 'green',
      }).isOk()
    ).toBe(true);
  });

  it('rejects invalid showAs shape', () => {
    expect(NumberShowAs.create({ type: 'pie', color: 'blue' }).isErr()).toBe(true);
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
    expect([single, multi].every((r) => r.isOk())).toBe(true);
    if (single.isErr() || multi.isErr()) return;
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
