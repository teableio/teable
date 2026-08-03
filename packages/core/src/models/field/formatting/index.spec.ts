/* eslint-disable sonarjs/no-duplicate-string */
import { describe, it, expect } from 'vitest';
import { DateFormattingPreset, TimeFormatting } from './datetime';
import { NumberFormattingType } from './number';
import { unionFormattingSchema } from './index';

describe('unionFormattingSchema - Smart Error Messages', () => {
  describe('Number Formatting Validation', () => {
    it('should validate correct decimal formatting', () => {
      const result = unionFormattingSchema.safeParse({
        type: NumberFormattingType.Decimal,
        precision: 4,
      });

      expect(result.success).toBe(true);
    });

    it('should validate correct percent formatting', () => {
      const result = unionFormattingSchema.safeParse({
        type: NumberFormattingType.Percent,
        precision: 2,
      });

      expect(result.success).toBe(true);
    });

    it('should validate correct currency formatting', () => {
      const result = unionFormattingSchema.safeParse({
        type: NumberFormattingType.Currency,
        precision: 2,
        symbol: '¥',
      });

      expect(result.success).toBe(true);
    });

    it('FIXED: should give clear error when type is missing', () => {
      const result = unionFormattingSchema.safeParse({
        precision: 4,
      });

      expect(result.success).toBe(false);

      if (!result.success) {
        const errorMessage = result.error.message;

        expect(errorMessage).toContain('type');
        expect(errorMessage).not.toContain('expression');
        expect(errorMessage).not.toContain('countall');
        expect(errorMessage).not.toContain('sum({values})');
        expect(errorMessage).not.toContain('date');
        expect(errorMessage).not.toContain('timeZone');
      }
    });

    it('should give clear error for invalid precision', () => {
      const result = unionFormattingSchema.safeParse({
        type: NumberFormattingType.Decimal,
        precision: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message.toLowerCase()).toContain('precision');
      }
    });

    it('should list available types when type value is invalid', () => {
      const result = unionFormattingSchema.safeParse({
        type: 'invalid_type',
        precision: 2,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessage = result.error.message;
        expect(errorMessage).toContain('type');
      }
    });

    it('should show available types in error message when type is missing', () => {
      const result = unionFormattingSchema.safeParse({
        precision: 4,
        symbol: '$',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessage = result.error.message;
        expect(errorMessage).toContain('decimal');
        expect(errorMessage).toContain('percent');
        expect(errorMessage).toContain('currency');
      }
    });

    it('should give clear error for missing symbol in currency', () => {
      const result = unionFormattingSchema.safeParse({
        type: NumberFormattingType.Currency,
        precision: 2,
        // 缺少 symbol
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('symbol');
      }
    });
  });

  describe('Datetime Formatting Validation', () => {
    it('should validate correct datetime formatting', () => {
      const result = unionFormattingSchema.safeParse({
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.None,
        timeZone: 'Asia/Shanghai',
      });

      expect(result.success).toBe(true);
    });

    it('should give clear error for missing date field', () => {
      const result = unionFormattingSchema.safeParse({
        time: TimeFormatting.Hour24,
        timeZone: 'Asia/Shanghai',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('date');
        expect(result.error.message).not.toContain('precision');
        expect(result.error.message).not.toContain('decimal');
      }
    });

    it('should give clear error for missing timeZone', () => {
      const result = unionFormattingSchema.safeParse({
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.None,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('timeZone');
      }
    });
  });

  describe('Mixed Fields Detection', () => {
    it('should detect mixed number and datetime fields', () => {
      const result = unionFormattingSchema.safeParse({
        type: NumberFormattingType.Decimal,
        precision: 2,
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.None,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Cannot mix');
        expect(result.error.message).toContain('number');
        expect(result.error.message).toContain('datetime');
      }
    });

    it('should detect symbol (number) mixed with date (datetime)', () => {
      const result = unionFormattingSchema.safeParse({
        symbol: '$',
        date: DateFormattingPreset.ISO,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Cannot mix');
      }
    });
  });

  describe('Type Field Validation', () => {
    it('should clearly indicate type is only for number formatting, not datetime', () => {
      const validNumber = unionFormattingSchema.safeParse({
        type: 'decimal',
        precision: 2,
      });
      expect(validNumber.success).toBe(true);

      const validDatetime = unionFormattingSchema.safeParse({
        date: 'YYYY-MM-DD',
        time: 'HH:mm',
        timeZone: 'UTC',
      });
      expect(validDatetime.success).toBe(true);
    });

    it('should reject type field in datetime formatting context', () => {
      const result = unionFormattingSchema.safeParse({
        date: 'YYYY-MM-DD',
        type: 'decimal',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Cannot mix');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty object', () => {
      const result = unionFormattingSchema.safeParse({});

      expect(result.success).toBe(false);
      // 应该得到标准的 union 错误
    });

    it('should handle null', () => {
      const result = unionFormattingSchema.safeParse(null);

      expect(result.success).toBe(false);
    });

    it('should handle undefined', () => {
      const result = unionFormattingSchema.safeParse(undefined);

      expect(result.success).toBe(false);
    });

    it('should reject unrecognized fields', () => {
      const result = unionFormattingSchema.safeParse({
        type: NumberFormattingType.Decimal,
        precision: 2,
        unknownField: 'value', // 不应该存在的字段
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('unknownField');
      }
    });
  });

  describe('Real-world Scenarios', () => {
    it('exchange rate field with correct formatting', () => {
      const correct = unionFormattingSchema.safeParse({
        type: 'decimal',
        precision: 4,
      });
      expect(correct.success).toBe(true);

      const incorrect = unionFormattingSchema.safeParse({
        precision: 4,
      });
      expect(incorrect.success).toBe(false);
      if (!incorrect.success) {
        const msg = incorrect.error.message;
        expect(msg).toContain('type');
        expect(msg.toLowerCase()).toMatch(/decimal|percent|currency/);
      }
    });

    it('currency field with symbol', () => {
      const result = unionFormattingSchema.safeParse({
        type: 'currency',
        precision: 2,
        symbol: '¥',
      });
      expect(result.success).toBe(true);
    });

    it('percentage field', () => {
      const result = unionFormattingSchema.safeParse({
        type: 'percent',
        precision: 1,
      });
      expect(result.success).toBe(true);
    });

    it('datetime field', () => {
      const result = unionFormattingSchema.safeParse({
        date: 'YYYY-MM-DD',
        time: 'HH:mm',
        timeZone: 'UTC',
      });
      expect(result.success).toBe(true);
    });
  });
});
