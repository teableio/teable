import { describe, it, expect } from 'vitest';
import { normalizeDatetimeFormatExpression } from '../utils/datetime-format.util';

describe('normalizeDatetimeFormatExpression', () => {
  describe('default handling', () => {
    it('should return default for null input', () => {
      expect(normalizeDatetimeFormatExpression(null)).toBe("'YYYY-MM-DD'");
    });

    it('should return default for undefined input', () => {
      expect(normalizeDatetimeFormatExpression(undefined)).toBe("'YYYY-MM-DD'");
    });

    it('should return default for non-string input', () => {
      // @ts-expect-error testing non-string input
      expect(normalizeDatetimeFormatExpression(123)).toBe("'YYYY-MM-DD'");
    });

    it('should return default for empty string', () => {
      expect(normalizeDatetimeFormatExpression('')).toBe("'YYYY-MM-DD'");
    });

    it('should return default for whitespace only', () => {
      expect(normalizeDatetimeFormatExpression('   ')).toBe("'YYYY-MM-DD'");
    });
  });

  describe('non-quoted strings', () => {
    it('should return input as-is if not starting with quote', () => {
      expect(normalizeDatetimeFormatExpression('YYYY-MM-DD')).toBe('YYYY-MM-DD');
    });

    it('should return input as-is if not ending with quote', () => {
      expect(normalizeDatetimeFormatExpression("'YYYY-MM-DD")).toBe("'YYYY-MM-DD");
    });

    it('should return input as-is if only starting with quote', () => {
      expect(normalizeDatetimeFormatExpression("'format")).toBe("'format");
    });
  });

  describe('Moment style token normalization', () => {
    it('should normalize HH to HH24', () => {
      expect(normalizeDatetimeFormatExpression("'HH:mm'")).toBe("'HH24:MI'");
    });

    it('should normalize hh to HH12', () => {
      expect(normalizeDatetimeFormatExpression("'hh:mm'")).toBe("'HH12:MI'");
    });

    it('should normalize ss to SS', () => {
      expect(normalizeDatetimeFormatExpression("'ss'")).toBe("'SS'");
    });

    it('should normalize YYYY-MM-DD', () => {
      expect(normalizeDatetimeFormatExpression("'YYYY-MM-DD'")).toBe("'YYYY-MM-DD'");
    });

    it('should normalize YY', () => {
      expect(normalizeDatetimeFormatExpression("'YY'")).toBe("'YY'");
    });

    it('should normalize M to FMMM', () => {
      expect(normalizeDatetimeFormatExpression("'M'")).toBe("'FMMM'");
    });

    it('should normalize D to FMDD', () => {
      expect(normalizeDatetimeFormatExpression("'D'")).toBe("'FMDD'");
    });

    it('should normalize H to FMHH24', () => {
      expect(normalizeDatetimeFormatExpression("'H'")).toBe("'FMHH24'");
    });

    it('should normalize h to FMHH12', () => {
      expect(normalizeDatetimeFormatExpression("'h'")).toBe("'FMHH12'");
    });

    it('should normalize m to FMMI', () => {
      expect(normalizeDatetimeFormatExpression("'m'")).toBe("'FMMI'");
    });

    it('should normalize s to FMSS', () => {
      expect(normalizeDatetimeFormatExpression("'s'")).toBe("'FMSS'");
    });

    it('should normalize A to AM', () => {
      expect(normalizeDatetimeFormatExpression("'A'")).toBe("'AM'");
    });

    it('should normalize a to am', () => {
      expect(normalizeDatetimeFormatExpression("'a'")).toBe("'am'");
    });
  });

  describe('Postgres textual token normalization', () => {
    it('should normalize Month to FMMonth', () => {
      expect(normalizeDatetimeFormatExpression("'Month'")).toBe("'FMMonth'");
    });

    it('should normalize MONTH to FMMONTH', () => {
      expect(normalizeDatetimeFormatExpression("'MONTH'")).toBe("'FMMONTH'");
    });

    it('should normalize month to FMmonth', () => {
      expect(normalizeDatetimeFormatExpression("'month'")).toBe("'FMmonth'");
    });

    it('should normalize Day to FMDay', () => {
      expect(normalizeDatetimeFormatExpression("'Day'")).toBe("'FMDay'");
    });

    it('should normalize DAY to FMDAY', () => {
      expect(normalizeDatetimeFormatExpression("'DAY'")).toBe("'FMDAY'");
    });

    it('should normalize day to FMday', () => {
      expect(normalizeDatetimeFormatExpression("'day'")).toBe("'FMday'");
    });
  });

  describe('Postgres passthrough tokens', () => {
    it('should passthrough HH24', () => {
      expect(normalizeDatetimeFormatExpression("'HH24'")).toBe("'HH24'");
    });

    it('should passthrough HH12', () => {
      expect(normalizeDatetimeFormatExpression("'HH12'")).toBe("'HH12'");
    });

    it('should passthrough MI', () => {
      expect(normalizeDatetimeFormatExpression("'MI'")).toBe("'MI'");
    });

    it('should passthrough MS', () => {
      expect(normalizeDatetimeFormatExpression("'MS'")).toBe("'MS'");
    });

    it('should passthrough SS', () => {
      expect(normalizeDatetimeFormatExpression("'SS'")).toBe("'SS'");
    });
  });

  describe('single-character token context', () => {
    it('should not normalize single char when preceded by alpha', () => {
      // 'AM' - A is preceded by nothing, but AM is a token
      expect(normalizeDatetimeFormatExpression("'AM'")).toBe("'AM'");
    });

    it('should not normalize M in the middle of a word', () => {
      // Testing that single-char M is not replaced when surrounded by alpha chars
      expect(normalizeDatetimeFormatExpression("'XMX'")).toBe("'XMX'");
    });

    it('should not normalize D in the middle of a word', () => {
      expect(normalizeDatetimeFormatExpression("'XDX'")).toBe("'XDX'");
    });

    it('should not normalize H in the middle of a word', () => {
      expect(normalizeDatetimeFormatExpression("'XHX'")).toBe("'XHX'");
    });

    it('should normalize standalone M with separator', () => {
      expect(normalizeDatetimeFormatExpression("'M/D'")).toBe("'FMMM/FMDD'");
    });

    it('should normalize M at end with separator before', () => {
      expect(normalizeDatetimeFormatExpression("'/M'")).toBe("'/FMMM'");
    });

    it('should normalize M at start with separator after', () => {
      expect(normalizeDatetimeFormatExpression("'M/'")).toBe("'FMMM/'");
    });
  });

  describe('complex format strings', () => {
    it('should normalize full datetime format', () => {
      expect(normalizeDatetimeFormatExpression("'YYYY-MM-DD HH:mm:ss'")).toBe(
        "'YYYY-MM-DD HH24:MI:SS'"
      );
    });

    it('should normalize 12-hour format with AM/PM', () => {
      expect(normalizeDatetimeFormatExpression("'hh:mm A'")).toBe("'HH12:MI AM'");
    });

    it('should handle non-token characters', () => {
      expect(normalizeDatetimeFormatExpression("'YYYY年MM月DD日'")).toBe("'YYYY年MM月DD日'");
    });

    it('should escape single quotes in result', () => {
      expect(normalizeDatetimeFormatExpression("'YYYY''MM''DD'")).toBe("'YYYY''''MM''''DD'");
    });
  });
});
