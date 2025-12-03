/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INumberFormatting } from './number';
import { NumberFormattingType, formatNumberToString, numberFormattingSchema } from './number';

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

describe('numberFormattingSchema validation', () => {
  describe('Valid formatting', () => {
    it('should pass with correct decimal formatting', () => {
      const validDecimal = { type: 'decimal', precision: 2 };
      const result = numberFormattingSchema.safeParse(validDecimal);
      expect(result.success).toBe(true);
    });

    it('should pass with correct percent formatting', () => {
      const validPercent = { type: 'percent', precision: 1 };
      const result = numberFormattingSchema.safeParse(validPercent);
      expect(result.success).toBe(true);
    });

    it('should pass with correct currency formatting', () => {
      const validCurrency = { type: 'currency', symbol: '¥', precision: 2 };
      const result = numberFormattingSchema.safeParse(validCurrency);
      expect(result.success).toBe(true);
    });
  });

  describe('Type-specific error messages', () => {
    it('should detect missing precision and unrecognized symbol for decimal', () => {
      const invalidDecimal = { type: 'decimal', symbol: '$' }; // Missing precision, wrong field

      const result = numberFormattingSchema.safeParse(invalidDecimal);
      expect(result.success).toBe(false);

      if (!result.success) {
        // Should have exactly 2 errors: missing precision + unrecognized key (symbol)
        expect(result.error.issues).toHaveLength(2);

        const errorCodes = result.error.issues.map((i) => i.code);
        expect(errorCodes).toContain('invalid_type'); // missing precision
        expect(errorCodes).toContain('unrecognized_keys'); // extra symbol
      }
    });

    it('should detect missing precision and unrecognized symbol for percent', () => {
      const invalidPercent = { type: 'percent', symbol: '%' }; // Missing precision, wrong field

      const result = numberFormattingSchema.safeParse(invalidPercent);
      expect(result.success).toBe(false);

      if (!result.success) {
        // Should have exactly 2 errors: missing precision + unrecognized key (symbol)
        expect(result.error.issues).toHaveLength(2);

        const errorCodes = result.error.issues.map((i) => i.code);
        expect(errorCodes).toContain('invalid_type'); // missing precision
        expect(errorCodes).toContain('unrecognized_keys'); // extra symbol
      }
    });

    it('should detect missing symbol for currency', () => {
      const invalidCurrency = { type: 'currency', precision: 2 }; // Missing symbol

      const result = numberFormattingSchema.safeParse(invalidCurrency);
      expect(result.success).toBe(false);

      if (!result.success) {
        // Should have exactly 1 error: missing symbol
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].path).toEqual(['symbol']);
      }
    });

    it('should detect missing symbol and unrecognized currencyCode', () => {
      const wrongCurrency = {
        type: 'currency',
        currencyCode: 'CNY', // Wrong field
        precision: 2, // Missing symbol
      };

      const result = numberFormattingSchema.safeParse(wrongCurrency);
      expect(result.success).toBe(false);

      if (!result.success) {
        // Should have exactly 2 errors: missing symbol + unrecognized key (currencyCode)
        expect(result.error.issues).toHaveLength(2);

        const errorCodes = result.error.issues.map((i) => i.code);
        expect(errorCodes).toContain('invalid_type'); // missing symbol
        expect(errorCodes).toContain('unrecognized_keys'); // extra currencyCode
      }
    });

    it('should reject invalid type (discriminatedUnion behavior)', () => {
      const invalidType = { type: 'money', precision: 2 }; // Invalid type

      const result = numberFormattingSchema.safeParse(invalidType);
      expect(result.success).toBe(false);

      if (!result.success) {
        // discriminatedUnion returns "Invalid input" for unmatched discriminator
        expect(result.error.issues[0].code).toBe('invalid_union');
        expect(result.error.issues[0].path).toEqual(['type']);
      }
    });

    it('should reject missing type (discriminatedUnion behavior)', () => {
      const missingType = { precision: 2 }; // Missing type

      const result = numberFormattingSchema.safeParse(missingType);
      expect(result.success).toBe(false);

      if (!result.success) {
        // discriminatedUnion returns "Invalid input" for missing discriminator
        expect(result.error.issues[0].code).toBe('invalid_union');
        expect(result.error.issues[0].path).toEqual(['type']);
      }
    });
  });
});
