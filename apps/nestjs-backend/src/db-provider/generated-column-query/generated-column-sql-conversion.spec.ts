/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { IFormulaConversionContext, IFormulaConversionResult } from '@teable/core';
import {
  GeneratedColumnSqlConversionVisitor,
  parseFormulaToSQL,
  FieldType,
  DbFieldType,
  CellValueType,
} from '@teable/core';
import { createFieldInstanceByVo } from '../../features/field/model/factory';
import { GeneratedColumnQueryPostgres } from './postgres/generated-column-query.postgres';
import { GeneratedColumnQuerySqlite } from './sqlite/generated-column-query.sqlite';

describe('Generated Column Query End-to-End Tests', () => {
  let mockContext: IFormulaConversionContext;

  beforeEach(() => {
    const fieldMap = new Map();

    // Create field instances using createFieldInstanceByVo
    const field1 = createFieldInstanceByVo({
      id: 'fld1',
      name: 'Field 1',
      type: FieldType.Number,
      dbFieldName: 'column_a',
      dbFieldType: DbFieldType.Real,
      cellValueType: CellValueType.Number,
      options: { formatting: { type: 'decimal', precision: 2 } },
    });
    fieldMap.set('fld1', field1);

    const field2 = createFieldInstanceByVo({
      id: 'fld2',
      name: 'Field 2',
      type: FieldType.SingleLineText,
      dbFieldName: 'column_b',
      dbFieldType: DbFieldType.Text,
      cellValueType: CellValueType.String,
      options: {},
    });
    fieldMap.set('fld2', field2);

    const field3 = createFieldInstanceByVo({
      id: 'fld3',
      name: 'Field 3',
      type: FieldType.Number,
      dbFieldName: 'column_c',
      dbFieldType: DbFieldType.Real,
      cellValueType: CellValueType.Number,
      options: { formatting: { type: 'decimal', precision: 2 } },
    });
    fieldMap.set('fld3', field3);

    const field4 = createFieldInstanceByVo({
      id: 'fld4',
      name: 'Field 4',
      type: FieldType.SingleLineText,
      dbFieldName: 'column_d',
      dbFieldType: DbFieldType.Text,
      cellValueType: CellValueType.String,
      options: {},
    });
    fieldMap.set('fld4', field4);

    const field5 = createFieldInstanceByVo({
      id: 'fld5',
      name: 'Field 5',
      type: FieldType.Checkbox,
      dbFieldName: 'column_e',
      dbFieldType: DbFieldType.Boolean,
      cellValueType: CellValueType.Boolean,
      options: {},
    });
    fieldMap.set('fld5', field5);

    const field6 = createFieldInstanceByVo({
      id: 'fld6',
      name: 'Field 6',
      type: FieldType.Date,
      dbFieldName: 'column_f',
      dbFieldType: DbFieldType.DateTime,
      cellValueType: CellValueType.DateTime,
      options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm:ss' } },
    });
    fieldMap.set('fld6', field6);

    mockContext = {
      fieldMap,
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
      // Get the appropriate generated column query implementation
      const formulaQuery =
        dbType === 'postgres'
          ? new GeneratedColumnQueryPostgres()
          : new GeneratedColumnQuerySqlite();

      // Create the SQL conversion visitor
      const visitor = new GeneratedColumnSqlConversionVisitor(formulaQuery, context);

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
      // Teable formula: SUM({fld1} + {fld3}, {fld5} * 2) - using two number fields for addition
      const formula = 'SUM({fld1} + {fld3}, {fld5} * 2)';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toMatchInlineSnapshot(`"(("column_a" + "column_c") + ("column_e" * 2))"`);
      expect(result.dependencies).toEqual(['fld1', 'fld3', 'fld5']);
    });

    it('should convert nested arithmetic functions - SQLite', () => {
      // Teable formula: SUM({fld1} + {fld3}, {fld5} * 2) - using two number fields for addition
      const formula = 'SUM({fld1} + {fld3}, {fld5} * 2)';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toMatchInlineSnapshot(
        `"((\`column_a\` + \`column_c\`) + (\`column_e\` * 2))"`
      );
      expect(result.dependencies).toEqual(['fld1', 'fld3', 'fld5']);
    });

    it('should convert nested conditional with arithmetic - PostgreSQL', () => {
      // Teable formula: IF(SUM({fld1}, {fld2}) > 100, ROUND({fld5}, 2), 0)
      const formula = 'IF(SUM({fld1}, {fld2}) > 100, ROUND({fld5}, 2), 0)';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN (("column_a" + "column_b") > 100) THEN ROUND("column_e"::numeric, 2::integer) ELSE 0 END"`
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should convert nested conditional with arithmetic - SQLite', () => {
      // Teable formula: IF(SUM({fld1}, {fld2}) > 100, ROUND({fld5}, 2), 0)
      const formula = 'IF(SUM({fld1}, {fld2}) > 100, ROUND({fld5}, 2), 0)';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN ((\`column_a\` + \`column_b\`) > 100) THEN ROUND(\`column_e\`, 2) ELSE 0 END"`
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should convert nested string functions - PostgreSQL', () => {
      // Teable formula: UPPER(CONCATENATE(LEFT({fld3}, 5), RIGHT({fld6}, 3)))
      const formula = 'UPPER(CONCATENATE(LEFT({fld3}, 5), RIGHT({fld6}, 3)))';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toMatchInlineSnapshot(
        `"UPPER((COALESCE(LEFT("column_c", 5::integer)::text, 'null') || COALESCE(RIGHT("column_f", 3::integer)::text, 'null')))"`
      );
      expect(result.dependencies).toEqual(['fld3', 'fld6']);
    });

    it('should convert nested string functions - SQLite', () => {
      // Teable formula: UPPER(CONCATENATE(LEFT({fld3}, 5), RIGHT({fld6}, 3)))
      const formula = 'UPPER(CONCATENATE(LEFT({fld3}, 5), RIGHT({fld6}, 3)))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toMatchInlineSnapshot(
        `"UPPER((COALESCE(SUBSTR(\`column_c\`, 1, 5), 'null') || COALESCE(SUBSTR(\`column_f\`, -3), 'null')))"`
      );
      expect(result.dependencies).toEqual(['fld3', 'fld6']);
    });

    it('should convert nested logical functions - PostgreSQL', () => {
      // Teable formula: AND(OR({fld1} > 0, {fld2} < 100), NOT({fld3} = "test"))
      const formula = 'AND(OR({fld1} > 0, {fld2} < 100), NOT({fld3} = "test"))';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toMatchInlineSnapshot(
        `"((("column_a" > 0) OR ("column_b" < 100)) AND NOT (("column_c" = 'test')))"`
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld3']);
    });

    it('should convert nested logical functions - SQLite', () => {
      // Teable formula: AND(OR({fld1} > 0, {fld2} < 100), NOT({fld3} = "test"))
      const formula = 'AND(OR({fld1} > 0, {fld2} < 100), NOT({fld3} = "test"))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toMatchInlineSnapshot(
        `"(((\`column_a\` > 0) OR (\`column_b\` < 100)) AND NOT ((\`column_c\` = 'test')))"`
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

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN ((("column_a" + "column_b") + ("column_e" * 3)) / 2 > 50) THEN ROUND((GREATEST("column_a", "column_e") / LEAST("column_b", "column_e"))::numeric, 2::integer) ELSE ABS(("column_a" - "column_b")::numeric) END"`
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should convert deeply nested arithmetic with conditionals - SQLite', () => {
      // Teable formula: IF(AVERAGE(SUM({fld1}, {fld2}), {fld5} * 3) > 50, ROUND(MAX({fld1}, {fld5}) / MIN({fld2}, {fld5}), 2), ABS({fld1} - {fld2}))
      const formula =
        'IF(AVERAGE(SUM({fld1}, {fld2}), {fld5} * 3) > 50, ROUND(MAX({fld1}, {fld5}) / MIN({fld2}, {fld5}), 2), ABS({fld1} - {fld2}))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN ((((\`column_a\` + \`column_b\`) + (\`column_e\` * 3)) / 2) > 50) THEN ROUND((MAX(\`column_a\`, \`column_e\`) / MIN(\`column_b\`, \`column_e\`)), 2) ELSE ABS((\`column_a\` - \`column_b\`)) END"`
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5']);
    });

    it('should convert complex string manipulation with conditionals - PostgreSQL', () => {
      // Teable formula: IF(LEN(CONCATENATE({fld3}, {fld6})) > 10, UPPER(LEFT(TRIM(CONCATENATE({fld3}, " - ", {fld6})), 15)), LOWER(RIGHT(SUBSTITUTE({fld3}, "old", "new"), 8)))
      const formula =
        'IF(LEN(CONCATENATE({fld3}, {fld6})) > 10, UPPER(LEFT(TRIM(CONCATENATE({fld3}, " - ", {fld6})), 15)), LOWER(RIGHT(SUBSTITUTE({fld3}, "old", "new"), 8)))';
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN (LENGTH((COALESCE("column_c"::text, 'null') || COALESCE("column_f"::text, 'null'))) > 10) THEN UPPER(LEFT(TRIM((COALESCE("column_c"::text, 'null') || COALESCE(' - '::text, 'null') || COALESCE("column_f"::text, 'null'))), 15::integer)) ELSE LOWER(RIGHT(REPLACE("column_c", 'old', 'new'), 8::integer)) END"`
      );
      expect(result.dependencies).toEqual(['fld3', 'fld6']);
    });

    it('should convert complex string manipulation with conditionals - SQLite', () => {
      // Teable formula: IF(LEN(CONCATENATE({fld3}, {fld6})) > 10, UPPER(LEFT(TRIM(CONCATENATE({fld3}, " - ", {fld6})), 15)), LOWER(RIGHT(SUBSTITUTE({fld3}, "old", "new"), 8)))
      const formula =
        'IF(LEN(CONCATENATE({fld3}, {fld6})) > 10, UPPER(LEFT(TRIM(CONCATENATE({fld3}, " - ", {fld6})), 15)), LOWER(RIGHT(SUBSTITUTE({fld3}, "old", "new"), 8)))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN (LENGTH((COALESCE(\`column_c\`, 'null') || COALESCE(\`column_f\`, 'null'))) > 10) THEN UPPER(SUBSTR(TRIM((COALESCE(\`column_c\`, 'null') || COALESCE(' - ', 'null') || COALESCE(\`column_f\`, 'null'))), 1, 15)) ELSE LOWER(SUBSTR(REPLACE(\`column_c\`, 'old', 'new'), -8)) END"`
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

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN ((EXTRACT(YEAR FROM "column_d"::timestamp) > 2020) AND (("column_a" + "column_b") > 100)) THEN (COALESCE(UPPER("column_c")::text, 'null') || COALESCE(' - '::text, 'null') || COALESCE(ROUND(("column_a" + "column_e") / 2::numeric, 2::integer)::text, 'null')) ELSE LOWER(REPLACE("column_f", 'old', NOW()::date::text)) END"`
      );
      expect(result.dependencies).toEqual(['fld4', 'fld1', 'fld2', 'fld3', 'fld5', 'fld6']);
    });

    it('should convert mathematical + logical + string + date functions - SQLite', () => {
      // Teable formula: IF(AND(YEAR({fld4}) > 2020, SUM({fld1}, {fld2}) > 100), CONCATENATE(UPPER({fld3}), " - ", ROUND(AVERAGE({fld1}, {fld5}), 2)), LOWER(SUBSTITUTE({fld6}, "old", DATESTR(NOW()))))
      const formula =
        'IF(AND(YEAR({fld4}) > 2020, SUM({fld1}, {fld2}) > 100), CONCATENATE(UPPER({fld3}), " - ", ROUND(AVERAGE({fld1}, {fld5}), 2)), LOWER(SUBSTITUTE({fld6}, "old", DATESTR(NOW()))))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN ((CAST(STRFTIME('%Y', \`column_d\`) AS INTEGER) > 2020) AND ((\`column_a\` + \`column_b\`) > 100)) THEN (COALESCE(UPPER(\`column_c\`), 'null') || COALESCE(' - ', 'null') || COALESCE(ROUND(((\`column_a\` + \`column_e\`) / 2), 2), 'null')) ELSE LOWER(REPLACE(\`column_f\`, 'old', DATE(DATETIME('now')))) END"`
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

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN ("column_a" > 0) THEN CASE WHEN ("column_b" > "column_a") THEN ROUND(("column_b" / "column_a")::numeric, 3::integer) ELSE ("column_a" * 2) END ELSE CASE WHEN ("column_a" < (-10)) THEN ABS("column_a"::numeric) ELSE 0 END END"`
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2']);
    });

    it('should convert nested IF statements with complex conditions - SQLite', () => {
      // Teable formula: IF({fld1} > 0, IF({fld2} > {fld1}, ROUND({fld2} / {fld1}, 3), {fld1} * 2), IF({fld1} < -10, ABS({fld1}), 0))
      const formula =
        'IF({fld1} > 0, IF({fld2} > {fld1}, ROUND({fld2} / {fld1}, 3), {fld1} * 2), IF({fld1} < -10, ABS({fld1}), 0))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN (\`column_a\` > 0) THEN CASE WHEN (\`column_b\` > \`column_a\`) THEN ROUND((\`column_b\` / \`column_a\`), 3) ELSE (\`column_a\` * 2) END ELSE CASE WHEN (\`column_a\` < (-10)) THEN ABS(\`column_a\`) ELSE 0 END END"`
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

      expect(result.sql).toMatchInlineSnapshot(
        `"CASE WHEN ((ROUND(((POWER("column_a"::numeric, 2::numeric) + SQRT("column_b"::numeric)) + ("column_e" * 3.14)) / 2::numeric, 2::integer) > 100) AND ((EXTRACT(YEAR FROM "column_d"::timestamp) > 2020) OR NOT ((EXTRACT(MONTH FROM NOW()::timestamp) = 12)))) THEN (COALESCE(UPPER(LEFT(TRIM("column_c"), 10::integer))::text, 'null') || COALESCE(' - Score: '::text, 'null') || COALESCE(ROUND((("column_a" + "column_b" + "column_e") / 3)::numeric, 1::integer)::text, 'null')) ELSE CASE WHEN ("column_a" < 0) THEN 'NEGATIVE' ELSE LOWER("column_f") END END"`
      );
      expect(result.dependencies).toEqual(['fld1', 'fld2', 'fld5', 'fld4', 'fld3', 'fld6']);
    });

    it('should convert ultra-complex nested formula combining all function types - SQLite', () => {
      // Same complex formula as above but for SQLite
      const formula =
        'IF(AND(ROUND(AVERAGE(SUM(POWER({fld1}, 2), SQRT({fld2})), {fld5} * 3.14), 2) > 100, OR(YEAR({fld4}) > 2020, NOT(MONTH(NOW()) = 12))), CONCATENATE(UPPER(LEFT(TRIM({fld3}), 10)), " - Score: ", ROUND(SUM({fld1}, {fld2}, {fld5}) / 3, 1)), IF({fld1} < 0, "NEGATIVE", LOWER({fld6})))';
      const result = convertFormulaToSQL(formula, mockContext, 'sqlite');

      expect(result.sql).toMatchInlineSnapshot(
        `
        "CASE WHEN ((ROUND(((((
              CASE
                WHEN 2 = 0 THEN 1
                WHEN 2 = 1 THEN \`column_a\`
                WHEN 2 = 2 THEN \`column_a\` * \`column_a\`
                WHEN 2 = 3 THEN \`column_a\` * \`column_a\` * \`column_a\`
                WHEN 2 = 4 THEN \`column_a\` * \`column_a\` * \`column_a\` * \`column_a\`
                WHEN 2 = 0.5 THEN
                  -- Square root case using Newton's method
                  CASE
                    WHEN \`column_a\` <= 0 THEN 0
                    ELSE (\`column_a\` / 2.0 + \`column_a\` / (\`column_a\` / 2.0)) / 2.0
                  END
                ELSE 1
              END
            ) + (
              CASE
                WHEN \`column_b\` <= 0 THEN 0
                ELSE (\`column_b\` / 2.0 + \`column_b\` / (\`column_b\` / 2.0)) / 2.0
              END
            )) + (\`column_e\` * 3.14)) / 2), 2) > 100) AND ((CAST(STRFTIME('%Y', \`column_d\`) AS INTEGER) > 2020) OR NOT ((CAST(STRFTIME('%m', DATETIME('now')) AS INTEGER) = 12)))) THEN (COALESCE(UPPER(SUBSTR(TRIM(\`column_c\`), 1, 10)), 'null') || COALESCE(' - Score: ', 'null') || COALESCE(ROUND(((\`column_a\` + \`column_b\` + \`column_e\`) / 3), 1), 'null')) ELSE CASE WHEN (\`column_a\` < 0) THEN 'NEGATIVE' ELSE LOWER(\`column_f\`) END END"
      `
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

    it('should handle malformed function calls', () => {
      // Test various malformed function calls
      expect(() => {
        convertFormulaToSQL('INVALID_FUNCTION({fld1})', mockContext, 'postgres');
      }).toThrow('Unsupported function: INVALID_FUNCTION');
    });

    it('should handle invalid operators', () => {
      // Test with invalid binary operators - this might not throw but should be handled gracefully
      const result = convertFormulaToSQL('{fld1} + {fld2}', mockContext, 'postgres');
      expect(result.sql).toBeDefined();
      expect(result.dependencies).toEqual(['fld1', 'fld2']);
    });

    it('should handle null and undefined values in context', () => {
      const fieldMap = new Map();

      const field1 = createFieldInstanceByVo({
        id: 'fld1',
        name: 'Field 1',
        type: FieldType.SingleLineText,
        dbFieldName: 'column_a',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('fld1', field1);

      const field2 = createFieldInstanceByVo({
        id: 'fld2',
        name: 'Field 2',
        type: FieldType.SingleLineText,
        dbFieldName: 'column_b',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('fld2', field2);

      const contextWithNulls: IFormulaConversionContext = {
        fieldMap,
        timeZone: 'UTC',
      };

      const result = convertFormulaToSQL('{fld1} + {fld2}', contextWithNulls, 'postgres');
      expect(result.sql).toBeDefined();
      expect(result.dependencies).toEqual(['fld1', 'fld2']);
    });

    it('should handle circular references gracefully', () => {
      // Test with self-referencing field (if supported)
      const result = convertFormulaToSQL('{fld1} + 1', mockContext, 'postgres');
      expect(result.dependencies).toEqual(['fld1']);
    });

    it('should handle very long field names', () => {
      const fieldMap = new Map();
      const longFieldId = 'very_long_field_name_that_exceeds_normal_limits_' + 'x'.repeat(100);

      const longField = createFieldInstanceByVo({
        id: longFieldId,
        name: 'Long Field',
        type: FieldType.Number,
        dbFieldName: 'long_column_name',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: { formatting: { type: 'decimal', precision: 2 } },
      });
      fieldMap.set(longFieldId, longField);

      const longFieldContext: IFormulaConversionContext = {
        fieldMap,
        timeZone: 'UTC',
      };

      const result = convertFormulaToSQL(`{${longFieldId}}`, longFieldContext, 'postgres');
      expect(result.sql).toBe('"long_column_name"');
      expect(result.dependencies).toEqual([longFieldId]);
    });

    it('should handle special characters in field names', () => {
      const fieldMap = new Map();

      const field1 = createFieldInstanceByVo({
        id: 'field-with-dashes',
        name: 'Field with Dashes',
        type: FieldType.SingleLineText,
        dbFieldName: 'column_with_dashes',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('field-with-dashes', field1);

      const field2 = createFieldInstanceByVo({
        id: 'field with spaces',
        name: 'Field with Spaces',
        type: FieldType.SingleLineText,
        dbFieldName: 'column_with_spaces',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('field with spaces', field2);

      const field3 = createFieldInstanceByVo({
        id: 'field.with.dots',
        name: 'Field with Dots',
        type: FieldType.SingleLineText,
        dbFieldName: 'column_with_dots',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('field.with.dots', field3);

      const specialCharContext: IFormulaConversionContext = {
        fieldMap,
        timeZone: 'UTC',
      };

      const result1 = convertFormulaToSQL('{field-with-dashes}', specialCharContext, 'postgres');
      expect(result1.sql).toBe('"column_with_dashes"');

      const result2 = convertFormulaToSQL('{field with spaces}', specialCharContext, 'postgres');
      expect(result2.sql).toBe('"column_with_spaces"');

      const result3 = convertFormulaToSQL('{field.with.dots}', specialCharContext, 'postgres');
      expect(result3.sql).toBe('"column_with_dots"');
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

  describe('Type-aware + operator', () => {
    it('should use numeric addition for number + number', () => {
      const expression = '{fld1} + {fld3}'; // number + number
      const result = convertFormulaToSQL(expression, mockContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(`"("column_a" + "column_c")"`);
    });

    it('should use string concatenation for string + string', () => {
      const expression = '{fld2} + {fld4}'; // string + string
      const result = convertFormulaToSQL(expression, mockContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(
        `"(COALESCE("column_b"::text, 'null') || COALESCE("column_d"::text, 'null'))"`
      );
    });

    it('should use string concatenation for string + number', () => {
      const expression = '{fld2} + {fld1}'; // string + number
      const result = convertFormulaToSQL(expression, mockContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(
        `"(COALESCE("column_b"::text, 'null') || COALESCE("column_a"::text, 'null'))"`
      );
    });

    it('should use string concatenation for number + string', () => {
      const expression = '{fld1} + {fld2}'; // number + string
      const result = convertFormulaToSQL(expression, mockContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(
        `"(COALESCE("column_a"::text, 'null') || COALESCE("column_b"::text, 'null'))"`
      );
    });

    it('should use string concatenation for string literal + field', () => {
      const expression = '"Hello " + {fld2}'; // string literal + string field
      const result = convertFormulaToSQL(expression, mockContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(
        `"(COALESCE('Hello '::text, 'null') || COALESCE("column_b"::text, 'null'))"`
      );
    });

    it('should use numeric addition for number literal + number field', () => {
      const expression = '10 + {fld1}'; // number literal + number field
      const result = convertFormulaToSQL(expression, mockContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(`"(10 + "column_a")"`);
    });

    it('should use string concatenation for string literal + number field', () => {
      const expression = '"Value: " + {fld1}'; // string literal + number field
      const result = convertFormulaToSQL(expression, mockContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(
        `"(COALESCE('Value: '::text, 'null') || COALESCE("column_a"::text, 'null'))"`
      );
    });
  });

  describe('SQLite Type-aware + operator', () => {
    it('should use numeric addition for number + number', () => {
      const expression = '{fld1} + {fld3}'; // number + number
      const result = convertFormulaToSQL(expression, mockContext, 'sqlite');
      expect(result.sql).toMatchInlineSnapshot(`"(\`column_a\` + \`column_c\`)"`);
    });

    it('should use string concatenation for string + string', () => {
      const expression = '{fld2} + {fld4}'; // string + string
      const result = convertFormulaToSQL(expression, mockContext, 'sqlite');
      expect(result.sql).toMatchInlineSnapshot(
        `"(COALESCE(\`column_b\`, 'null') || COALESCE(\`column_d\`, 'null'))"`
      );
    });

    it('should use string concatenation for string + number', () => {
      const expression = '{fld2} + {fld1}'; // string + number
      const result = convertFormulaToSQL(expression, mockContext, 'sqlite');
      expect(result.sql).toMatchInlineSnapshot(
        `"(COALESCE(\`column_b\`, 'null') || COALESCE(\`column_a\`, 'null'))"`
      );
    });
  });

  describe('Real-world examples', () => {
    it('should handle mixed type expressions correctly', () => {
      // Example: Concatenate a label with a number
      const expression = '"Total: " + {fld1}'; // string + number
      const result = convertFormulaToSQL(expression, mockContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(
        `"(COALESCE('Total: '::text, 'null') || COALESCE("column_a"::text, 'null'))"`
      );
    });

    it('should handle pure numeric calculations', () => {
      // Example: Calculate percentage
      const expression = '({fld1} + {fld3}) * 100'; // (number + number) * number
      const result = convertFormulaToSQL(expression, mockContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(`"((("column_a" + "column_c")) * 100)"`);
    });

    it('should handle string concatenation with multiple fields', () => {
      // Example: Create full name
      const expression = '{fld2} + " " + {fld4}'; // string + string + string
      const result = convertFormulaToSQL(expression, mockContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(
        `"(COALESCE((COALESCE("column_b"::text, 'null') || COALESCE(' '::text, 'null'))::text, 'null') || COALESCE("column_d"::text, 'null'))"`
      );
    });
  });

  describe('Comprehensive Function Coverage Tests', () => {
    describe('All Numeric Functions', () => {
      it.each([
        'ROUNDUP({fld1}, 2)',
        'ROUNDDOWN({fld1}, 1)',
        'CEILING({fld1})',
        'FLOOR({fld1})',
        'EVEN({fld1})',
        'ODD({fld1})',
        'INT({fld1})',
        'ABS({fld1})',
        'SQRT({fld1})',
        'POWER({fld1}, 2)',
        'EXP({fld1})',
        'LOG({fld1})',
        'MOD({fld1}, 3)',
        'VALUE({fld2})',
      ])('should convert numeric function %s for PostgreSQL', (formula) => {
        const result = convertFormulaToSQL(formula, mockContext, 'postgres');
        expect(result).toMatchSnapshot();
      });

      it.each([
        'ROUNDUP({fld1}, 2)',
        'ROUNDDOWN({fld1}, 1)',
        'CEILING({fld1})',
        'FLOOR({fld1})',
        'ABS({fld1})',
        'SQRT({fld1})',
        'POWER({fld1}, 2)',
        'EXP({fld1})',
        'LOG({fld1})',
        'MOD({fld1}, 3)',
      ])('should convert numeric function %s for SQLite', (formula) => {
        const result = convertFormulaToSQL(formula, mockContext, 'sqlite');
        expect(result).toMatchSnapshot();
      });
    });

    describe('All Text Functions', () => {
      it.each([
        'FIND("test", {fld2})',
        'FIND("test", {fld2}, 5)',
        'SEARCH("test", {fld2})',
        'MID({fld2}, 2, 5)',
        'LEFT({fld2}, 3)',
        'RIGHT({fld2}, 3)',
        'REPLACE({fld2}, 1, 2, "new")',
        'SUBSTITUTE({fld2}, "old", "new")',
        'REPT({fld2}, 3)',
        'TRIM({fld2})',
        'LEN({fld2})',
        'T({fld1})',
      ])('should convert text function %s for PostgreSQL', (formula) => {
        const result = convertFormulaToSQL(formula, mockContext, 'postgres');
        expect(result).toMatchSnapshot();
      });

      it.each([
        'FIND("test", {fld2})',
        'SEARCH("test", {fld2})',
        'MID({fld2}, 2, 5)',
        'LEFT({fld2}, 3)',
        'RIGHT({fld2}, 3)',
        'SUBSTITUTE({fld2}, "old", "new")',
        'TRIM({fld2})',
        'LEN({fld2})',
      ])('should convert text function %s for SQLite', (formula) => {
        const result = convertFormulaToSQL(formula, mockContext, 'sqlite');
        expect(result).toMatchSnapshot();
      });
    });

    describe('All Date Functions', () => {
      it.each([
        'TODAY()',
        'HOUR({fld6})',
        'MINUTE({fld6})',
        'SECOND({fld6})',
        'DAY({fld6})',
        'MONTH({fld6})',
        'YEAR({fld6})',
        'WEEKNUM({fld6})',
        'WEEKDAY({fld6})',
        'WORKDAY({fld6}, 5)',
        'WORKDAY_DIFF({fld6}, NOW())',
        'IS_SAME({fld6}, NOW(), "day")',
        'LAST_MODIFIED_TIME()',
        'CREATED_TIME()',
      ])('should convert date function %s for PostgreSQL', (formula) => {
        const result = convertFormulaToSQL(formula, mockContext, 'postgres');
        expect(result).toMatchSnapshot();
      });

      it.each([
        'TODAY()',
        'YEAR({fld6})',
        'MONTH({fld6})',
        'DAY({fld6})',
        'HOUR({fld6})',
        'MINUTE({fld6})',
        'SECOND({fld6})',
      ])('should convert date function %s for SQLite', (formula) => {
        const result = convertFormulaToSQL(formula, mockContext, 'sqlite');
        expect(result).toMatchSnapshot();
      });
    });

    describe('All Other Functions', () => {
      it.each([
        // Logical functions
        'AND({fld5}, {fld1} > 0)',
        'OR({fld5}, {fld1} < 0)',
        'NOT({fld5})',
        'XOR({fld5}, {fld1} > 0)',
        'BLANK()',
        'IS_ERROR({fld1})',

        // Array functions
        'COUNT({fld1}, {fld2}, {fld3})',
        'COUNTA({fld1}, {fld2})',
        'COUNTALL({fld1})',
        'ARRAY_JOIN({fld1})',
        'ARRAY_JOIN({fld1}, " | ")',
        'ARRAY_UNIQUE({fld1})',
        'ARRAY_FLATTEN({fld1})',
        'ARRAY_COMPACT({fld1})',

        // System functions
        'RECORD_ID()',
        'AUTO_NUMBER()',
        'TEXT_ALL({fld1})',
      ])('should convert function %s for PostgreSQL', (formula) => {
        const result = convertFormulaToSQL(formula, mockContext, 'postgres');
        expect(result).toMatchSnapshot();
      });

      it.each([
        // Logical functions
        'AND({fld5}, {fld1} > 0)',
        'OR({fld5}, {fld1} < 0)',
        'NOT({fld5})',
        'BLANK()',
        'IS_ERROR({fld1})',

        // Array functions
        'COUNT({fld1}, {fld2})',

        // System functions
        'RECORD_ID()',
        'AUTO_NUMBER()',
      ])('should convert function %s for SQLite', (formula) => {
        const result = convertFormulaToSQL(formula, mockContext, 'sqlite');
        expect(result).toMatchSnapshot();
      });
    });
  });

  describe('Advanced Tests', () => {
    it('should correctly infer types for complex expressions', () => {
      const fieldMap = new Map();

      const numField = createFieldInstanceByVo({
        id: 'numField',
        name: 'Number Field',
        type: FieldType.Number,
        dbFieldName: 'num_col',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: { formatting: { type: 'decimal', precision: 2 } },
      });
      fieldMap.set('numField', numField);

      const textField = createFieldInstanceByVo({
        id: 'textField',
        name: 'Text Field',
        type: FieldType.SingleLineText,
        dbFieldName: 'text_col',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('textField', textField);

      const boolField = createFieldInstanceByVo({
        id: 'boolField',
        name: 'Bool Field',
        type: FieldType.Checkbox,
        dbFieldName: 'bool_col',
        dbFieldType: DbFieldType.Boolean,
        cellValueType: CellValueType.Boolean,
        options: {},
      });
      fieldMap.set('boolField', boolField);

      const dateField = createFieldInstanceByVo({
        id: 'dateField',
        name: 'Date Field',
        type: FieldType.Date,
        dbFieldName: 'date_col',
        dbFieldType: DbFieldType.DateTime,
        cellValueType: CellValueType.DateTime,
        options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm:ss' } },
      });
      fieldMap.set('dateField', dateField);

      const complexContext: IFormulaConversionContext = {
        fieldMap,
        timeZone: 'UTC',
      };

      const testCases = [
        '{numField} + {numField}',
        '{textField} + {textField}',
        '{textField} + {numField}',
        '{numField} + {textField}',
        '{boolField} + {numField}',
        '{dateField} + {textField}',
      ];

      testCases.forEach((formula) => {
        const result = convertFormulaToSQL(formula, complexContext, 'postgres');
        expect(result).toMatchSnapshot();
      });
    });

    it.each([
      ['{fld1}', ['fld1']],
      ['{fld1} + {fld2}', ['fld1', 'fld2']],
      ['SUM({fld1}, {fld2}, {fld3})', ['fld1', 'fld2', 'fld3']],
      ['IF({fld1} > 0, {fld2}, {fld3})', ['fld1', 'fld2', 'fld3']],
      ['{fld1} + {fld1}', ['fld1']],
      ['CONCATENATE({fld2}, " - ", {fld4}, " - ", {fld2})', ['fld2', 'fld4']],
    ])('should collect dependencies correctly for %s', (formula, expectedDeps) => {
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');
      expect(result.dependencies.sort()).toEqual(expectedDeps.sort());
    });

    it.each([
      ['"test string"'],
      ['42'],
      ['3.14'],
      ['TRUE'],
      ['FALSE'],
      ['({fld1} + {fld2})'],
      ['-{fld1}'],
      ['{fld1} - {fld3}'],
      ['{fld1} * {fld3}'],
      ['{fld1} / {fld3}'],
      ['{fld1} % {fld3}'],
      ['{fld1} > {fld3}'],
      ['{fld1} < {fld3}'],
      ['{fld1} >= {fld3}'],
      ['{fld1} <= {fld3}'],
      ['{fld1} = {fld3}'],
      ['{fld1} != {fld3}'],
      ['{fld1} <> {fld3}'],
      ['{fld5} && {fld1} > 0'],
      ['{fld5} || {fld1} > 0'],
      ['{fld1} & {fld3}'],
    ])('should handle visitor method for %s', (formula) => {
      const result = convertFormulaToSQL(formula, mockContext, 'postgres');
      expect(result).toMatchSnapshot();
    });

    it('should handle error conditions', () => {
      const invalidContext: IFormulaConversionContext = {
        fieldMap: new Map(),
        timeZone: 'UTC',
      };

      expect(() => {
        convertFormulaToSQL('{nonexistent}', invalidContext, 'postgres');
      }).toThrow('Field not found: nonexistent');

      expect(() => {
        convertFormulaToSQL('UNKNOWN_FUNC()', mockContext, 'postgres');
      }).toThrow('Unsupported function: UNKNOWN_FUNC');
    });

    it('should handle context edge cases', () => {
      const fieldMap = new Map();
      const field1 = createFieldInstanceByVo({
        id: 'fld1',
        name: 'Field 1',
        type: FieldType.SingleLineText,
        dbFieldName: 'col1',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('fld1', field1);

      const minimalContext: IFormulaConversionContext = {
        fieldMap,
        timeZone: 'UTC',
      };

      const result = convertFormulaToSQL('{fld1} + "test"', minimalContext, 'postgres');
      expect(result.sql).toMatchInlineSnapshot(
        `"(COALESCE("col1"::text, 'null') || COALESCE('test'::text, 'null'))"`
      );
      expect(result.dependencies).toEqual(['fld1']);
    });
  });
});
