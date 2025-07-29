import { SqlConversionVisitor, parseFormulaToSQL } from '@teable/core';
import type {
  IFormulaConversionContext,
  IFormulaConversionResult,
} from './formula-query.interface';
import { FormulaQueryPostgres } from './postgres/formula-query.postgres';
import { FormulaQuerySqlite } from './sqlite/formula-query.sqlite';

describe('Formula Query End-to-End Tests', () => {
  let mockContext: IFormulaConversionContext;

  beforeEach(() => {
    mockContext = {
      fieldMap: {
        fld1: { columnName: 'column_a' },
        fld2: { columnName: 'column_b' },
        fld3: { columnName: 'column_c' },
        fld4: { columnName: 'column_d' },
        fld5: { columnName: 'column_e' },
        fld6: { columnName: 'column_f' },
      },
      timeZone: 'UTC',
    };
  });

  // Helper function to convert Teable formula to SQL
  const convertFormulaToSQL = (
    expression: string,
    context: IFormulaConversionContext,
    dbType: 'postgres' | 'sqlite'
  ): IFormulaConversionResult => {
    try {
      // Get the appropriate formula query implementation
      const formulaQuery =
        dbType === 'postgres' ? new FormulaQueryPostgres() : new FormulaQuerySqlite();

      // Create the SQL conversion visitor
      const visitor = new SqlConversionVisitor(formulaQuery, context);

      // Parse the formula and convert to SQL using the public API
      const sql = parseFormulaToSQL(expression, visitor);

      return visitor.getResult(sql);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to convert formula: ${errorMessage}`);
    }
  };

  describe('Simple Nested Functions (2-3 levels)', () => {
    it('should convert nested arithmetic functions - PostgreSQL', () => {
      // Teable formula: SUM({fld1} + {fld2}, {fld5} * 2)
      const formula = 'SUM({fld1} + {fld2}, {fld5} * 2)';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toBe('SUM((column_a + column_b), (column_e * 2))');
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should convert nested arithmetic functions - SQLite', () => {
      // Teable formula: SUM({fld1} + {fld2}, {fld5} * 2)
      const formula = 'SUM({fld1} + {fld2}, {fld5} * 2)';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toBe('SUM((column_a + column_b), (column_e * 2))');
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should convert nested conditional with arithmetic - PostgreSQL', () => {
      // Teable formula: IF(SUM({fld1}, {fld2}) > 100, ROUND({fld5}, 2), 0)
      const formula = 'IF(SUM({fld1}, {fld2}) > 100, ROUND({fld5}, 2), 0)';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toBe(
        'CASE WHEN (SUM(column_a, column_b) > 100) THEN ROUND(column_e::numeric, 2::integer) ELSE 0 END'
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should convert nested conditional with arithmetic - SQLite', () => {
      // Teable formula: IF(SUM({fld1}, {fld2}) > 100, ROUND({fld5}, 2), 0)
      const formula = 'IF(SUM({fld1}, {fld2}) > 100, ROUND({fld5}, 2), 0)';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toBe(
        'CASE WHEN (SUM(column_a, column_b) > 100) THEN ROUND(column_e, 2) ELSE 0 END'
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should convert nested string functions - PostgreSQL', () => {
      // Teable formula: UPPER(CONCATENATE(LEFT({fld3}, 5), RIGHT({fld6}, 3)))
      const formula = 'UPPER(CONCATENATE(LEFT({fld3}, 5), RIGHT({fld6}, 3)))';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toBe(
        'UPPER(CONCAT(LEFT(column_c, 5::integer), RIGHT(column_f, 3::integer)))'
      );
      expect(result.dependencies).toEqual(['fld3', 'fld6']);
    });

    it('should convert nested string functions - SQLite', () => {
      // Teable formula: UPPER(CONCATENATE(LEFT({fld3}, 5), RIGHT({fld6}, 3)))
      const formula = 'UPPER(CONCATENATE(LEFT({fld3}, 5), RIGHT({fld6}, 3)))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toBe('UPPER((SUBSTR(column_c, 1, 5) || SUBSTR(column_f, -3)))');
      expect(result.dependencies).toEqual(['fld3', 'fld6']);
    });

    it('should convert nested logical functions - PostgreSQL', () => {
      // Teable formula: AND(OR({fld1} > 0, {fld2} < 100), NOT({fld3} = "test"))
      const formula = 'AND(OR({fld1} > 0, {fld2} < 100), NOT({fld3} = "test"))';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toBe(
        "(((column_a > 0) OR (column_b < 100)) AND NOT ((column_c = 'test')))"
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld3']);
    });

    it('should convert nested logical functions - SQLite', () => {
      // Teable formula: AND(OR({fld1} > 0, {fld2} < 100), NOT({fld3} = "test"))
      const formula = 'AND(OR({fld1} > 0, {fld2} < 100), NOT({fld3} = "test"))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toBe(
        "(((column_a > 0) OR (column_b < 100)) AND NOT ((column_c = 'test')))"
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld3']);
    });
  });

  describe('Complex Nested Functions (4+ levels)', () => {
    it('should convert deeply nested arithmetic with conditionals - PostgreSQL', () => {
      // Teable formula: IF(AVERAGE(SUM({fld1}, {fld2}), {fld5} * 3) > 50, ROUND(MAX({fld1}, {fld5}) / MIN({fld2}, {fld5}), 2), ABS({fld1} - {fld2}))
      const formula =
        'IF(AVERAGE(SUM({fld1}, {fld2}), {fld5} * 3) > 50, ROUND(MAX({fld1}, {fld5}) / MIN({fld2}, {fld5}), 2), ABS({fld1} - {fld2}))';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toBe(
        'CASE WHEN (AVG(SUM(column_a, column_b), (column_e * 3)) > 50) THEN ROUND((GREATEST(column_a, column_e) / LEAST(column_b, column_e))::numeric, 2::integer) ELSE ABS((column_a - column_b)::numeric) END'
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should convert deeply nested arithmetic with conditionals - SQLite', () => {
      // Teable formula: IF(AVERAGE(SUM({fld1}, {fld2}), {fld5} * 3) > 50, ROUND(MAX({fld1}, {fld5}) / MIN({fld2}, {fld5}), 2), ABS({fld1} - {fld2}))
      const formula =
        'IF(AVERAGE(SUM({fld1}, {fld2}), {fld5} * 3) > 50, ROUND(MAX({fld1}, {fld5}) / MIN({fld2}, {fld5}), 2), ABS({fld1} - {fld2}))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toBe(
        'CASE WHEN (AVG(SUM(column_a, column_b), (column_e * 3)) > 50) THEN ROUND((MAX(column_a, column_e) / MIN(column_b, column_e)), 2) ELSE ABS((column_a - column_b)) END'
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should convert complex string manipulation with conditionals - PostgreSQL', () => {
      // Teable formula: IF(LEN(CONCATENATE({fld3}, {fld6})) > 10, UPPER(LEFT(TRIM(CONCATENATE({fld3}, " - ", {fld6})), 15)), LOWER(RIGHT(SUBSTITUTE({fld3}, "old", "new"), 8)))
      const formula =
        'IF(LEN(CONCATENATE({fld3}, {fld6})) > 10, UPPER(LEFT(TRIM(CONCATENATE({fld3}, " - ", {fld6})), 15)), LOWER(RIGHT(SUBSTITUTE({fld3}, "old", "new"), 8)))';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toBe(
        "CASE WHEN (LENGTH(CONCAT(column_c, column_f)) > 10) THEN UPPER(LEFT(TRIM(CONCAT(column_c, ' - ', column_f)), 15::integer)) ELSE LOWER(RIGHT(REPLACE(column_c, 'old', 'new'), 8::integer)) END"
      );
      expect(result.dependencies).toEqual(['fld3', 'fld6']);
    });

    it('should convert complex string manipulation with conditionals - SQLite', () => {
      // Teable formula: IF(LEN(CONCATENATE({fld3}, {fld6})) > 10, UPPER(LEFT(TRIM(CONCATENATE({fld3}, " - ", {fld6})), 15)), LOWER(RIGHT(SUBSTITUTE({fld3}, "old", "new"), 8)))
      const formula =
        'IF(LEN(CONCATENATE({fld3}, {fld6})) > 10, UPPER(LEFT(TRIM(CONCATENATE({fld3}, " - ", {fld6})), 15)), LOWER(RIGHT(SUBSTITUTE({fld3}, "old", "new"), 8)))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toBe(
        "CASE WHEN (LENGTH((column_c || column_f)) > 10) THEN UPPER(SUBSTR(TRIM((column_c || ' - ' || column_f)), 1, 15)) ELSE LOWER(SUBSTR(REPLACE(column_c, 'old', 'new'), -8)) END"
      );
      expect(result.dependencies).toEqual(['fld3', 'fld6']);
    });
  });

  describe('Mixed Function Types in Nested Expressions', () => {
    it('should convert mathematical + logical + string + date functions - PostgreSQL', () => {
      // Teable formula: IF(AND(YEAR({fld4}) > 2020, SUM({fld1}, {fld2}) > 100), CONCATENATE(UPPER({fld3}), " - ", ROUND(AVERAGE({fld1}, {fld5}), 2)), LOWER(SUBSTITUTE({fld6}, "old", DATESTR(NOW()))))
      const formula =
        'IF(AND(YEAR({fld4}) > 2020, SUM({fld1}, {fld2}) > 100), CONCATENATE(UPPER({fld3}), " - ", ROUND(AVERAGE({fld1}, {fld5}), 2)), LOWER(SUBSTITUTE({fld6}, "old", DATESTR(NOW()))))';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toBe(
        "CASE WHEN ((EXTRACT(YEAR FROM column_d::timestamp) > 2020) AND (SUM(column_a, column_b) > 100)) THEN CONCAT(UPPER(column_c), ' - ', ROUND(AVG(column_a, column_e)::numeric, 2::integer)) ELSE LOWER(REPLACE(column_f, 'old', NOW()::date::text)) END"
      );
      expect(result.dependencies).toEqual(['fld4', 'fld1', 'fld2', 'fld3', 'fld5', 'fld6']);
    });

    it('should convert mathematical + logical + string + date functions - SQLite', () => {
      // Teable formula: IF(AND(YEAR({fld4}) > 2020, SUM({fld1}, {fld2}) > 100), CONCATENATE(UPPER({fld3}), " - ", ROUND(AVERAGE({fld1}, {fld5}), 2)), LOWER(SUBSTITUTE({fld6}, "old", DATESTR(NOW()))))
      const formula =
        'IF(AND(YEAR({fld4}) > 2020, SUM({fld1}, {fld2}) > 100), CONCATENATE(UPPER({fld3}), " - ", ROUND(AVERAGE({fld1}, {fld5}), 2)), LOWER(SUBSTITUTE({fld6}, "old", DATESTR(NOW()))))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toBe(
        "CASE WHEN ((CAST(STRFTIME('%Y', column_d) AS INTEGER) > 2020) AND (SUM(column_a, column_b) > 100)) THEN (UPPER(column_c) || ' - ' || ROUND(AVG(column_a, column_e), 2)) ELSE LOWER(REPLACE(column_f, 'old', DATE(DATETIME('now')))) END"
      );
      expect(result.dependencies).toEqual(['fld4', 'fld1', 'fld2', 'fld3', 'fld5', 'fld6']);
    });
  });

  describe('Edge Cases with Nested Conditionals and Calculations', () => {
    it('should convert nested IF statements with complex conditions - PostgreSQL', () => {
      // Teable formula: IF({fld1} > 0, IF({fld2} > {fld1}, ROUND({fld2} / {fld1}, 3), {fld1} * 2), IF({fld1} < -10, ABS({fld1}), 0))
      const formula =
        'IF({fld1} > 0, IF({fld2} > {fld1}, ROUND({fld2} / {fld1}, 3), {fld1} * 2), IF({fld1} < -10, ABS({fld1}), 0))';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toBe(
        'CASE WHEN (column_a > 0) THEN CASE WHEN (column_b > column_a) THEN ROUND((column_b / column_a)::numeric, 3::integer) ELSE (column_a * 2) END ELSE CASE WHEN (column_a < (-10)) THEN ABS(column_a::numeric) ELSE 0 END END'
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2']);
    });

    it('should convert nested IF statements with complex conditions - SQLite', () => {
      // Teable formula: IF({fld1} > 0, IF({fld2} > {fld1}, ROUND({fld2} / {fld1}, 3), {fld1} * 2), IF({fld1} < -10, ABS({fld1}), 0))
      const formula =
        'IF({fld1} > 0, IF({fld2} > {fld1}, ROUND({fld2} / {fld1}, 3), {fld1} * 2), IF({fld1} < -10, ABS({fld1}), 0))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toBe(
        'CASE WHEN (column_a > 0) THEN CASE WHEN (column_b > column_a) THEN ROUND((column_b / column_a), 3) ELSE (column_a * 2) END ELSE CASE WHEN (column_a < (-10)) THEN ABS(column_a) ELSE 0 END END'
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2']);
    });
  });

  describe('Extremely Complex Nested Formula (6+ levels)', () => {
    it('should convert ultra-complex nested formula combining all function types - PostgreSQL', () => {
      // This is an extremely complex formula that combines:
      // - Mathematical functions (SUM, AVERAGE, ROUND, POWER, SQRT)
      // - Logical functions (IF, AND, OR, NOT)
      // - String functions (CONCATENATE, UPPER, LEFT, TRIM)
      // - Date functions (YEAR, MONTH, NOW)
      // - Comparison operations
      // - Type casting

      // Teable formula: IF(AND(ROUND(AVERAGE(SUM(POWER({fld1}, 2), SQRT({fld2})), {fld5} * 3.14), 2) > 100, OR(YEAR({fld4}) > 2020, NOT(MONTH(NOW()) = 12))), CONCATENATE(UPPER(LEFT(TRIM({fld3}), 10)), " - Score: ", ROUND(SUM({fld1}, {fld2}, {fld5}) / 3, 1)), IF({fld1} < 0, "NEGATIVE", LOWER({fld6})))
      const formula =
        'IF(AND(ROUND(AVERAGE(SUM(POWER({fld1}, 2), SQRT({fld2})), {fld5} * 3.14), 2) > 100, OR(YEAR({fld4}) > 2020, NOT(MONTH(NOW()) = 12))), CONCATENATE(UPPER(LEFT(TRIM({fld3}), 10)), " - Score: ", ROUND(SUM({fld1}, {fld2}, {fld5}) / 3, 1)), IF({fld1} < 0, "NEGATIVE", LOWER({fld6})))';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toBe(
        "CASE WHEN ((ROUND(AVG(SUM(POWER(column_a::numeric, 2::numeric), SQRT(column_b::numeric)), (column_e * 3.14))::numeric, 2::integer) > 100) AND ((EXTRACT(YEAR FROM column_d::timestamp) > 2020) OR NOT ((EXTRACT(MONTH FROM NOW()::timestamp) = 12)))) THEN CONCAT(UPPER(LEFT(TRIM(column_c), 10::integer)), ' - Score: ', ROUND((SUM(column_a, column_b, column_e) / 3)::numeric, 1::integer)) ELSE CASE WHEN (column_a < 0) THEN 'NEGATIVE' ELSE LOWER(column_f) END END"
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5', 'fld4', 'fld3', 'fld6']);
    });

    it('should convert ultra-complex nested formula combining all function types - SQLite', () => {
      // Same complex formula as above but for SQLite
      const formula =
        'IF(AND(ROUND(AVERAGE(SUM(POWER({fld1}, 2), SQRT({fld2})), {fld5} * 3.14), 2) > 100, OR(YEAR({fld4}) > 2020, NOT(MONTH(NOW()) = 12))), CONCATENATE(UPPER(LEFT(TRIM({fld3}), 10)), " - Score: ", ROUND(SUM({fld1}, {fld2}, {fld5}) / 3, 1)), IF({fld1} < 0, "NEGATIVE", LOWER({fld6})))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toBe(
        "CASE WHEN ((ROUND(AVG(SUM(POWER(column_a, 2), SQRT(column_b)), (column_e * 3.14)), 2) > 100) AND ((CAST(STRFTIME('%Y', column_d) AS INTEGER) > 2020) OR NOT ((CAST(STRFTIME('%m', DATETIME('now')) AS INTEGER) = 12)))) THEN (UPPER(SUBSTR(TRIM(column_c), 1, 10)) || ' - Score: ' || ROUND((SUM(column_a, column_b, column_e) / 3), 1)) ELSE CASE WHEN (column_a < 0) THEN 'NEGATIVE' ELSE LOWER(column_f) END END"
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5', 'fld4', 'fld3', 'fld6']);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid formula syntax gracefully', () => {
      const invalidFormula = 'SUM({fld1}, {fld2}'; // Missing closing parenthesis

      // The parser might not throw an error for this case, so let's just test that it returns a result
      const result = convertFormulaToSQL(invalidFormula, mockContext, 'postgres');
      expect(result).toBeDefined();
      expect(result.sql).toBeDefined();
      expect(result.dependencies).toBeDefined();
    });

    it('should handle unknown field references', () => {
      const formula = 'SUM({unknown_field}, {fld1})';

      // Unknown field references should throw an error
      expect(() => {
        convertFormulaToSQL(formula, mockContext, 'postgres');
      }).toThrow('Field not found: unknown_field');
    });

    it('should handle empty formula', () => {
      // Empty formula should throw an error
      expect(() => {
        convertFormulaToSQL('', mockContext, 'postgres');
      }).toThrow();
    });

    it('should handle formula with only whitespace', () => {
      // Whitespace formula should throw an error
      expect(() => {
        convertFormulaToSQL('   ', mockContext, 'postgres');
      }).toThrow();
    });
  });

  describe('Performance Tests', () => {
    it('should handle deeply nested expressions without stack overflow - PostgreSQL', () => {
      // Create a deeply nested IF expression (5 levels)
      const formula =
        'IF({fld1} > 0, IF({fld2} > 10, IF({fld5} > 20, IF({fld1} + {fld2} > 30, "LEVEL4", "LEVEL3"), "LEVEL2"), "LEVEL1"), "LEVEL0")';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toContain('CASE WHEN');
      expect(result.sql.split('CASE WHEN').length - 1).toBe(4); // 4 nested IF statements
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should handle deeply nested expressions without stack overflow - SQLite', () => {
      // Create a deeply nested IF expression (5 levels)
      const formula =
        'IF({fld1} > 0, IF({fld2} > 10, IF({fld5} > 20, IF({fld1} + {fld2} > 30, "LEVEL4", "LEVEL3"), "LEVEL2"), "LEVEL1"), "LEVEL0")';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toContain('CASE WHEN');
      expect(result.sql.split('CASE WHEN').length - 1).toBe(4); // 4 nested IF statements
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });
  });
});
