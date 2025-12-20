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
});
