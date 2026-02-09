import { describe, it, expect } from 'vitest';
import {
  escapeSqlLiteral,
  sqlStringLiteral,
  buildErrorLiteral,
  safeJsonb,
  safeJsonbWithStrategy,
  normalizeToJsonArray,
  normalizeToJsonArrayWithStrategy,
  extractJsonScalarText,
  extractFirstJsonScalarText,
  extractFirstJsonScalarTextWithStrategy,
  stringifyNormalizedJsonArray,
  stringifyJsonArray,
  stringifyJsonArrayWithStrategy,
} from '../PgSqlHelpers';
import { Pg16TypeValidationStrategy, PgLegacyTypeValidationStrategy } from '../strategies';

describe('PgSqlHelpers', () => {
  describe('escapeSqlLiteral', () => {
    it('should escape single quotes', () => {
      expect(escapeSqlLiteral("test's")).toBe("test''s");
    });

    it('should escape multiple single quotes', () => {
      expect(escapeSqlLiteral("it's a test's")).toBe("it''s a test''s");
    });

    it('should handle no quotes', () => {
      expect(escapeSqlLiteral('test')).toBe('test');
    });
  });

  describe('sqlStringLiteral', () => {
    it('should wrap value in single quotes', () => {
      expect(sqlStringLiteral('test')).toBe("'test'");
    });

    it('should escape and wrap', () => {
      expect(sqlStringLiteral("it's")).toBe("'it''s'");
    });
  });

  describe('buildErrorLiteral', () => {
    it('should build PARSE error', () => {
      expect(buildErrorLiteral('PARSE', 'test')).toBe("'#ERROR:PARSE:test'");
    });

    it('should build TYPE error', () => {
      expect(buildErrorLiteral('TYPE', 'invalid')).toBe("'#ERROR:TYPE:invalid'");
    });

    it('should build DIV0 error', () => {
      expect(buildErrorLiteral('DIV0', 'division by zero')).toBe("'#ERROR:DIV0:division by zero'");
    });
  });

  describe('safeJsonb', () => {
    it('should generate SQL for jsonb conversion', () => {
      const result = safeJsonb('my_column');
      expect(result).toContain('pg_typeof');
      expect(result).toContain('jsonb');
      expect(result).toContain('my_column');
    });
  });

  describe('safeJsonbWithStrategy', () => {
    it('should work with Pg16TypeValidationStrategy', () => {
      const strategy = new Pg16TypeValidationStrategy();
      const result = safeJsonbWithStrategy('col', strategy);
      expect(result).toContain('pg_input_is_valid');
      expect(result).toContain('jsonb');
    });

    it('should work with PgLegacyTypeValidationStrategy', () => {
      const strategy = new PgLegacyTypeValidationStrategy();
      const result = safeJsonbWithStrategy('col', strategy);
      expect(result).toContain('teable_try_cast_valid');
      expect(result).toContain('jsonb');
    });
  });

  describe('normalizeToJsonArray (deprecated)', () => {
    it('should generate SQL for normalizing to JSON array', () => {
      const result = normalizeToJsonArray('my_column');
      expect(result).toContain('jsonb');
      expect(result).toContain('pg_input_is_valid');
      expect(result).toContain('my_column');
      expect(result).toContain("'[]'::jsonb");
    });
  });

  describe('normalizeToJsonArrayWithStrategy', () => {
    it('should work with Pg16TypeValidationStrategy', () => {
      const strategy = new Pg16TypeValidationStrategy();
      const result = normalizeToJsonArrayWithStrategy('col', strategy);
      expect(result).toContain('pg_input_is_valid');
      expect(result).toContain("'[]'::jsonb");
    });

    it('should work with PgLegacyTypeValidationStrategy', () => {
      const strategy = new PgLegacyTypeValidationStrategy();
      const result = normalizeToJsonArrayWithStrategy('col', strategy);
      expect(result).toContain('teable_try_cast_valid');
      expect(result).toContain("'[]'::jsonb");
    });
  });

  describe('extractJsonScalarText', () => {
    it('should generate SQL for extracting scalar text from JSON', () => {
      const result = extractJsonScalarText('elem');
      expect(result).toContain('jsonb_typeof');
      expect(result).toContain('object');
      expect(result).toContain('array');
      expect(result).toContain('title');
      expect(result).toContain('name');
    });
  });

  describe('extractFirstJsonScalarText (deprecated)', () => {
    it('should generate SQL for extracting first element as text', () => {
      const result = extractFirstJsonScalarText('my_array');
      expect(result).toContain('-> 0');
      expect(result).toContain('jsonb_typeof');
      expect(result).toContain('null');
    });
  });

  describe('extractFirstJsonScalarTextWithStrategy', () => {
    it('should work with Pg16TypeValidationStrategy', () => {
      const strategy = new Pg16TypeValidationStrategy();
      const result = extractFirstJsonScalarTextWithStrategy('col', strategy);
      expect(result).toContain('-> 0');
      expect(result).toContain('pg_input_is_valid');
    });

    it('should work with PgLegacyTypeValidationStrategy', () => {
      const strategy = new PgLegacyTypeValidationStrategy();
      const result = extractFirstJsonScalarTextWithStrategy('col', strategy);
      expect(result).toContain('-> 0');
      expect(result).toContain('teable_try_cast_valid');
    });
  });

  describe('stringifyNormalizedJsonArray', () => {
    it('should generate SQL for stringifying JSON array', () => {
      const result = stringifyNormalizedJsonArray("'[1,2,3]'::jsonb");
      expect(result).toContain('string_agg');
      expect(result).toContain('jsonb_array_elements');
      expect(result).toContain("', '");
    });

    it('should use custom separator', () => {
      const result = stringifyNormalizedJsonArray("'[1,2,3]'::jsonb", ' | ');
      expect(result).toContain("' | '");
    });
  });

  describe('stringifyJsonArray (deprecated)', () => {
    it('should generate SQL for stringifying JSON array', () => {
      const result = stringifyJsonArray('my_column');
      expect(result).toContain('string_agg');
      expect(result).toContain('pg_input_is_valid');
    });

    it('should use custom separator', () => {
      const result = stringifyJsonArray('my_column', '; ');
      expect(result).toContain("'; '");
    });
  });

  describe('stringifyJsonArrayWithStrategy', () => {
    it('should work with Pg16TypeValidationStrategy', () => {
      const strategy = new Pg16TypeValidationStrategy();
      const result = stringifyJsonArrayWithStrategy('col', strategy);
      expect(result).toContain('string_agg');
      expect(result).toContain('pg_input_is_valid');
    });

    it('should work with PgLegacyTypeValidationStrategy', () => {
      const strategy = new PgLegacyTypeValidationStrategy();
      const result = stringifyJsonArrayWithStrategy('col', strategy);
      expect(result).toContain('string_agg');
      expect(result).toContain('teable_try_cast_valid');
    });

    it('should use custom separator with strategy', () => {
      const strategy = new Pg16TypeValidationStrategy();
      const result = stringifyJsonArrayWithStrategy('col', strategy, ' - ');
      expect(result).toContain("' - '");
    });
  });
});
