/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INumberFormatting } from './number';
import { NumberFormattingType, formatNumberToString } from './number';

describe('formatNumberToString', () => {
  describe('Formatting Decimal', () => {
    const decimalFormatting: INumberFormatting = {
      type: NumberFormattingType.Decimal,
      precision: 2,
    };

    it('should correctly format number string with precision', () => {
      const num = 1234.5678;
      expect(formatNumberToString(num, decimalFormatting)).toBe('1234.57');
    });

    it('should return empty string for null', () => {
      const num = null;
      expect(formatNumberToString(num as any, decimalFormatting)).toBe('');
    });

    it('should correctly format integer', () => {
      const num = 1234;
      const formatting: INumberFormatting = { type: NumberFormattingType.Decimal, precision: 0 };
      expect(formatNumberToString(num, formatting)).toBe('1234');
    });
  });

  describe('Formatting Percent', () => {
    const percentFormatting: INumberFormatting = {
      type: NumberFormattingType.Percent,
      precision: 2,
    };

    it('should format a number as a percentage with the specified precision', () => {
      const num = 1.66667;
      expect(formatNumberToString(num, percentFormatting)).toBe('166.67%');
    });

    it('should return an empty string when given a null input', () => {
      const num = null;
      expect(formatNumberToString(num as any, percentFormatting)).toBe('');
    });
  });

  describe('Formatting Currency', () => {
    const currencyFormatting: INumberFormatting = {
      type: NumberFormattingType.Currency,
      symbol: '$',
      precision: 2,
    };

    it('should format a number as currency with the specified symbol and precision', () => {
      const num = 100.5678;
      expect(formatNumberToString(num, currencyFormatting)).toBe('$100.57');
    });

    it('should format a large number as currency with the specified symbol and precision', () => {
      const num = 10000000.234;
      expect(formatNumberToString(num, currencyFormatting)).toBe('$10,000,000.23');
    });

    it('should return an empty string when given a null input', () => {
      const num = null;
      expect(formatNumberToString(num as any, currencyFormatting)).toBe('');
    });
  });
});
