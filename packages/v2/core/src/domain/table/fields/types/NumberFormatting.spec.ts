import { describe, expect, it } from 'vitest';

import { NumberFormatting, NumberFormattingType } from './NumberFormatting';

describe('NumberFormatting', () => {
  it('accepts decimal, percent, and currency formatting', () => {
    const decimalResult = NumberFormatting.create({
      type: NumberFormattingType.Decimal,
      precision: 2,
    });
    expect(decimalResult.isOk()).toBe(true);

    const percentResult = NumberFormatting.create({
      type: NumberFormattingType.Percent,
      precision: 0,
    });
    expect(percentResult.isOk()).toBe(true);

    const currencyResult = NumberFormatting.create({
      type: NumberFormattingType.Currency,
      precision: 2,
      symbol: '$',
    });
    expect(currencyResult.isOk()).toBe(true);
  });

  it('rejects invalid precision or missing currency symbol', () => {
    const invalidPrecisionResult = NumberFormatting.create({
      type: NumberFormattingType.Decimal,
      precision: 6,
    });
    expect(invalidPrecisionResult.isErr()).toBe(true);

    const missingSymbolResult = NumberFormatting.create({
      type: NumberFormattingType.Currency,
      precision: 2,
    });
    expect(missingSymbolResult.isErr()).toBe(true);
  });
});
