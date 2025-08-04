/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { IFormulaConversionContext } from '@teable/core';
import { FieldType, DbFieldType, CellValueType } from '@teable/core';
import { plainToInstance } from 'class-transformer';
import knex from 'knex';
import type { Knex } from 'knex';
import { vi, describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { PostgresProvider } from '../src/db-provider/postgres.provider';
import { createFieldInstanceByVo } from '../src/features/field/model/factory';
import { FormulaFieldDto } from '../src/features/field/model/field-dto/formula-field.dto';

describe.skipIf(!process.env.PRISMA_DATABASE_URL?.includes('postgresql'))(
  'PostgreSQL Provider Formula Integration Tests',
  () => {
    let knexInstance: Knex;
    let postgresProvider: PostgresProvider;
    const testTableName = 'test_formula_table';

    // Fixed time for consistent testing
    const FIXED_TIME = new Date('2024-01-15T10:30:00.000Z');

    beforeAll(async () => {
      // Set fixed time for consistent date/time function testing
      vi.setSystemTime(FIXED_TIME);

      // Create Knex instance with PostgreSQL connection from environment
      const databaseUrl = process.env.PRISMA_DATABASE_URL;
      if (!databaseUrl?.includes('postgresql')) {
        throw new Error('PostgreSQL database URL not found in environment');
      }

      knexInstance = knex({
        client: 'pg',
        connection: databaseUrl,
      });

      postgresProvider = new PostgresProvider(knexInstance);

      // Drop table if exists and create test table with various column types
      await knexInstance.schema.dropTableIfExists(testTableName);
      await knexInstance.schema.createTable(testTableName, (table) => {
        table.string('id').primary();
        table.double('number_col');
        table.text('text_col');
        table.timestamp('date_col');
        table.boolean('boolean_col');
        table.double('number_col_2');
        table.text('text_col_2');
        table.jsonb('array_col'); // JSON array stored as JSONB
        table.timestamp('__created_time').defaultTo(knexInstance.fn.now());
        table.timestamp('__last_modified_time').defaultTo(knexInstance.fn.now());
        table.string('__id'); // System record ID column
        table.integer('__auto_number'); // System auto number column
      });
    });

    afterAll(async () => {
      await knexInstance.schema.dropTableIfExists(testTableName);
      await knexInstance.destroy();
      vi.useRealTimers();
    });

    beforeEach(async () => {
      // Clear test data before each test
      await knexInstance(testTableName).del();

      // Insert standard test data
      await knexInstance(testTableName).insert([
        {
          id: 'row1',
          number_col: 10,
          text_col: 'hello',
          date_col: '2024-01-10 08:00:00',
          boolean_col: true,
          number_col_2: 5,
          text_col_2: 'world',
          array_col: JSON.stringify(['apple', 'banana', 'cherry']),
          __created_time: '2024-01-10 08:00:00',
          __last_modified_time: '2024-01-10 08:00:00',
          __id: 'rec1',
          __auto_number: 1,
        },
        {
          id: 'row2',
          number_col: -3,
          text_col: 'test',
          date_col: '2024-01-12 15:30:00',
          boolean_col: false,
          number_col_2: 8,
          text_col_2: 'data',
          array_col: JSON.stringify(['apple', 'banana', 'apple']),
          __created_time: '2024-01-12 15:30:00',
          __last_modified_time: '2024-01-12 16:00:00',
          __id: 'rec2',
          __auto_number: 2,
        },
        {
          id: 'row3',
          number_col: 0,
          text_col: '',
          date_col: '2024-01-15 10:30:00',
          boolean_col: true,
          number_col_2: -2,
          text_col_2: null,
          array_col: JSON.stringify(['', 'test', null, 'valid']),
          __created_time: '2024-01-15 10:30:00',
          __last_modified_time: '2024-01-15 11:00:00',
          __id: 'rec3',
          __auto_number: 3,
        },
      ]);
    });

    // Counter for unique field IDs
    let fieldCounter = 0;

    // Helper function to create formula field instance
    function createFormulaField(
      expression: string,
      cellValueType: CellValueType = CellValueType.Number
    ): FormulaFieldDto {
      // Use a counter-based field ID for consistent but unique snapshots
      const fieldId = `test_field_${++fieldCounter}`;
      return plainToInstance(FormulaFieldDto, {
        id: fieldId,
        name: 'test_formula',
        type: FieldType.Formula,
        options: {
          dbGenerated: true,
          expression,
        },
        cellValueType,
        dbFieldType: DbFieldType.Text,
        dbFieldName: `fld_${fieldId}`,
      });
    }

    // Helper function to create conversion context
    function createContext(): IFormulaConversionContext {
      const fieldMap = new Map();

      // Create number field
      const numberField = createFieldInstanceByVo({
        id: 'fld_number',
        name: 'Number Field',
        type: FieldType.Number,
        dbFieldName: 'number_col',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: { formatting: { type: 'decimal', precision: 2 } },
      });
      fieldMap.set('fld_number', numberField);

      // Create text field
      const textField = createFieldInstanceByVo({
        id: 'fld_text',
        name: 'Text Field',
        type: FieldType.SingleLineText,
        dbFieldName: 'text_col',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('fld_text', textField);

      // Create date field
      const dateField = createFieldInstanceByVo({
        id: 'fld_date',
        name: 'Date Field',
        type: FieldType.Date,
        dbFieldName: 'date_col',
        dbFieldType: DbFieldType.DateTime,
        cellValueType: CellValueType.DateTime,
        options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm:ss' } },
      });
      fieldMap.set('fld_date', dateField);

      // Create boolean field
      const booleanField = createFieldInstanceByVo({
        id: 'fld_boolean',
        name: 'Boolean Field',
        type: FieldType.Checkbox,
        dbFieldName: 'boolean_col',
        dbFieldType: DbFieldType.Boolean,
        cellValueType: CellValueType.Boolean,
        options: {},
      });
      fieldMap.set('fld_boolean', booleanField);

      // Create second number field
      const numberField2 = createFieldInstanceByVo({
        id: 'fld_number_2',
        name: 'Number Field 2',
        type: FieldType.Number,
        dbFieldName: 'number_col_2',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: { formatting: { type: 'decimal', precision: 2 } },
      });
      fieldMap.set('fld_number_2', numberField2);

      // Create second text field
      const textField2 = createFieldInstanceByVo({
        id: 'fld_text_2',
        name: 'Text Field 2',
        type: FieldType.SingleLineText,
        dbFieldName: 'text_col_2',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('fld_text_2', textField2);

      // Create array field (MultipleSelect)
      const arrayField = createFieldInstanceByVo({
        id: 'fld_array',
        name: 'Array Field',
        type: FieldType.MultipleSelect,
        dbFieldName: 'array_col',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        options: {
          choices: [
            { name: 'apple', color: 'red' },
            { name: 'banana', color: 'yellow' },
            { name: 'cherry', color: 'red' },
            { name: 'test', color: 'blue' },
            { name: 'valid', color: 'green' },
          ],
        },
      });
      fieldMap.set('fld_array', arrayField);

      return {
        fieldMap,
      };
    }

    // Helper function to test formula execution
    async function testFormulaExecution(
      expression: string,
      expectedResults: unknown[],
      cellValueType: CellValueType = CellValueType.Number
    ) {
      const formulaField = createFormulaField(expression, cellValueType);
      const context = createContext();

      try {
        // Generate SQL for creating the formula column
        const sql = postgresProvider.createColumnSchema(
          testTableName,
          formulaField,
          context.fieldMap
        );
        expect(sql).toMatchSnapshot(`PostgreSQL SQL for ${expression}`);

        // Execute the SQL to add the generated column
        await knexInstance.raw(sql);

        // Query the results
        const generatedColumnName = formulaField.getGeneratedColumnName();
        const results = await knexInstance(testTableName)
          .select('id', generatedColumnName)
          .orderBy('id');

        // Verify results
        const actualResults = results.map((row) => row[generatedColumnName]);
        expect(actualResults).toEqual(expectedResults);

        // Clean up: drop the generated column for next test (use lowercase for PostgreSQL)
        const cleanupColumnName = generatedColumnName.toLowerCase();
        await knexInstance.raw(`ALTER TABLE ${testTableName} DROP COLUMN "${cleanupColumnName}"`);
      } catch (error) {
        console.error(`Error testing formula "${expression}":`, error);
        throw error;
      }
    }

    // Helper function to test unsupported formulas
    async function testUnsupportedFormula(
      expression: string,
      cellValueType: CellValueType = CellValueType.Number
    ) {
      const formulaField = createFormulaField(expression, cellValueType);
      const context = createContext();

      try {
        // Generate SQL for creating the formula column
        const sql = postgresProvider.createColumnSchema(
          testTableName,
          formulaField,
          context.fieldMap
        );

        // For unsupported functions, we expect an empty SQL string
        expect(sql).toBe('');
        expect(sql).toMatchSnapshot(`PostgreSQL SQL for ${expression}`);
      } catch (error) {
        console.error(`Error testing unsupported formula "${expression}":`, error);
        throw error;
      }
    }

    describe('Basic Math Functions', () => {
      it('should handle simple arithmetic operations', async () => {
        // PostgreSQL returns strings, so we expect string results
        await testFormulaExecution(
          '{fld_number} + {fld_number_2}',
          ['15', '5', '-2'],
          CellValueType.String
        );
        await testFormulaExecution(
          '{fld_number} - {fld_number_2}',
          ['5', '-11', '2'],
          CellValueType.String
        );
        await testFormulaExecution(
          '{fld_number} * {fld_number_2}',
          ['50', '-24', '-0'],
          CellValueType.String
        );
        await testFormulaExecution(
          '{fld_number} / {fld_number_2}',
          ['2', '-0.375', '-0'],
          CellValueType.String
        );
      });

      it('should handle ABS function', async () => {
        await testFormulaExecution('ABS({fld_number})', ['10', '3', '0'], CellValueType.String);
        await testFormulaExecution('ABS({fld_number_2})', ['5', '8', '2'], CellValueType.String);
      });

      it('should handle ROUND function', async () => {
        await testFormulaExecution('ROUND(3.14159, 2)', ['3.14', '3.14', '3.14']);
        await testFormulaExecution('ROUND({fld_number} / 3, 1)', ['3.3', '-1.0', '0.0']);
      });

      it('should handle CEILING and FLOOR functions', async () => {
        await testFormulaExecution('CEILING(3.14)', ['4', '4', '4']);
        await testFormulaExecution('FLOOR(3.99)', ['3', '3', '3']);
      });

      it('should handle SQRT and POWER functions', async () => {
        await testFormulaExecution('SQRT(16)', [
          '4.000000000000000',
          '4.000000000000000',
          '4.000000000000000',
        ]);
        await testFormulaExecution('POWER(2, 3)', [
          '8.0000000000000000',
          '8.0000000000000000',
          '8.0000000000000000',
        ]);
      });

      it('should handle MAX and MIN functions', async () => {
        await testFormulaExecution('MAX({fld_number}, {fld_number_2})', ['10', '8', '0']);
        await testFormulaExecution('MIN({fld_number}, {fld_number_2})', ['5', '-3', '-2']);
      });

      it('should handle ROUNDUP and ROUNDDOWN functions', async () => {
        await testFormulaExecution('ROUNDUP(3.14159, 2)', ['3.15', '3.15', '3.15']);
        await testFormulaExecution('ROUNDDOWN(3.99999, 2)', ['3.99', '3.99', '3.99']);
      });

      it('should handle EVEN and ODD functions', async () => {
        await testFormulaExecution('EVEN(3)', ['4', '4', '4']);
        await testFormulaExecution('ODD(4)', ['5', '5', '5']);
      });

      it('should handle INT function', async () => {
        await testFormulaExecution('INT(3.99)', ['3', '3', '3']);
        await testFormulaExecution('INT(-2.5)', ['-3', '-3', '-3']); // PostgreSQL FLOOR behavior
      });

      it('should handle EXP and LOG functions', async () => {
        await testFormulaExecution('EXP(1)', [
          '2.7182818284590452',
          '2.7182818284590452',
          '2.7182818284590452',
        ]);
        await testFormulaExecution('LOG(2.718281828459045)', [
          '0.9999999999999999',
          '0.9999999999999999',
          '0.9999999999999999',
        ]); // Floating point precision
      });

      it('should handle MOD function', async () => {
        await testFormulaExecution('MOD(10, 3)', ['1', '1', '1']);
        await testFormulaExecution('MOD({fld_number}, 3)', ['1', '0', '0']);
      });

      it('should handle SUM function', async () => {
        await testFormulaExecution('SUM({fld_number}, {fld_number_2})', ['15', '5', '-2']);
        await testFormulaExecution('SUM(1, 2, 3)', ['6', '6', '6']);
      });

      it('should handle AVERAGE function', async () => {
        await testFormulaExecution('AVERAGE({fld_number}, {fld_number_2})', ['7.5', '2.5', '-1']);
        await testFormulaExecution('AVERAGE(1, 2, 3)', ['2', '2', '2']);
      });

      it('should handle VALUE function', async () => {
        await testFormulaExecution('VALUE("123")', ['123', '123', '123']);
        await testFormulaExecution('VALUE("45.67")', ['45.67', '45.67', '45.67']);
      });
    });

    describe('String Functions', () => {
      it('should handle CONCATENATE function', async () => {
        await testFormulaExecution(
          'CONCATENATE({fld_text}, " ", {fld_text_2})',
          ['hello world', 'test data', null], // Empty strings result in null
          CellValueType.String
        );
      });

      it('should handle LEFT, RIGHT, and MID functions', async () => {
        await testFormulaExecution('LEFT("hello", 3)', ['hel', 'hel', 'hel'], CellValueType.String);
        await testFormulaExecution(
          'RIGHT("hello", 3)',
          ['llo', 'llo', 'llo'],
          CellValueType.String
        );
        await testFormulaExecution(
          'MID("hello", 2, 3)',
          ['ell', 'ell', 'ell'],
          CellValueType.String
        );
      });

      it('should handle LEN function', async () => {
        await testFormulaExecution('LEN({fld_text})', ['5', '4', '0']);
        await testFormulaExecution('LEN("test")', ['4', '4', '4']);
      });

      // UPPER and LOWER functions are not supported (moved to Unsupported Functions section)

      it('should handle TRIM function', async () => {
        await testFormulaExecution(
          'TRIM("  hello  ")',
          ['hello', 'hello', 'hello'],
          CellValueType.String
        );
      });

      // FIND and SEARCH functions are not supported (moved to Unsupported Functions section)

      it('should handle REPLACE function', async () => {
        await testFormulaExecution(
          'REPLACE("hello", 2, 2, "i")',
          ['hilo', 'hilo', 'hilo'],
          CellValueType.String
        );
      });

      // SUBSTITUTE function is not supported (moved to Unsupported Functions section)

      it('should handle REPT function', async () => {
        await testFormulaExecution('REPT("a", 3)', ['aaa', 'aaa', 'aaa'], CellValueType.String);
      });

      // REGEXP_REPLACE function is not supported (moved to Unsupported Functions section)

      // ENCODE_URL_COMPONENT function is not supported (moved to Unsupported Functions section)

      // T function is not supported (moved to Unsupported Functions section)
    });

    describe('Logical Functions', () => {
      it('should handle IF function', async () => {
        await testFormulaExecution(
          'IF({fld_number} > 0, "positive", "non-positive")',
          ['positive', 'non-positive', 'non-positive'],
          CellValueType.String
        );
      });

      it('should handle AND and OR functions', async () => {
        await testFormulaExecution('AND({fld_boolean}, {fld_number} > 0)', [
          'true',
          'false',
          'false',
        ]);
        await testFormulaExecution('OR({fld_boolean}, {fld_number} > 0)', [
          'true',
          'false',
          'true',
        ]);
      });

      it('should handle NOT function', async () => {
        await testFormulaExecution('NOT({fld_boolean})', ['false', 'true', 'false']);
      });

      it('should handle XOR function', async () => {
        await testFormulaExecution('XOR({fld_boolean}, {fld_number} > 0)', [
          'false',
          'false',
          'true',
        ]);
      });

      it('should handle SWITCH function', async () => {
        await testFormulaExecution(
          'SWITCH({fld_number}, 10, "ten", -3, "negative three", 0, "zero", "other")',
          ['ten', 'negative three', 'zero'],
          CellValueType.String
        );
      });

      it('should handle BLANK function', async () => {
        await testFormulaExecution('BLANK()', [null, null, null]);
      });

      it('should throw error for ERROR function', async () => {
        const formulaField = createFormulaField('ERROR("Test error")');
        const context = createContext();

        await expect(async () => {
          const sql = postgresProvider.createColumnSchema(
            testTableName,
            formulaField,
            context.fieldMap
          );
          await knexInstance.raw(sql);
        }).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: The query is empty]`);
      });

      it('should throw error for ISERROR function', async () => {
        const formulaField = createFormulaField('ISERROR({fld_number})');
        const context = createContext();

        await expect(async () => {
          const sql = postgresProvider.createColumnSchema(
            testTableName,
            formulaField,
            context.fieldMap
          );
          await knexInstance.raw(sql);
        }).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: The query is empty]`);
      });
    });

    describe('Column References', () => {
      it('should handle single column references', async () => {
        await testFormulaExecution('{fld_number}', ['10', '-3', '0']);
        await testFormulaExecution('{fld_text}', ['hello', 'test', ''], CellValueType.String);
      });

      it('should handle arithmetic with column references', async () => {
        await testFormulaExecution('{fld_number} + {fld_number_2}', ['15', '5', '-2']);
        await testFormulaExecution('{fld_number} * 2', ['20', '-6', '0']);
      });

      it('should handle string operations with column references', async () => {
        await testFormulaExecution(
          'CONCATENATE({fld_text}, "-", {fld_text_2})',
          ['hello-world', 'test-data', null], // Empty strings result in null
          CellValueType.String
        );
      });
    });

    describe('DateTime Functions', () => {
      it('should handle NOW and TODAY functions with fixed time', async () => {
        await testFormulaExecution(
          'TODAY()',
          ['2024-01-15', '2024-01-15', '2024-01-15'],
          CellValueType.String
        );
        await testFormulaExecution(
          'NOW()',
          ['2024-01-15 10:30:00', '2024-01-15 10:30:00', '2024-01-15 10:30:00'],
          CellValueType.String
        );
      });

      // Date extraction functions with column references are not supported (moved to Unsupported Functions section)

      // DATETIME_DIFF function is not supported (moved to Unsupported Functions section)

      // IS_AFTER, IS_BEFORE, IS_SAME functions are not supported (moved to Unsupported Functions section)

      // DATETIME_FORMAT function is not supported (moved to Unsupported Functions section)

      // DATE_ADD function is not supported (moved to Unsupported Functions section)

      // DATETIME_PARSE function is not supported (moved to Unsupported Functions section)

      it('should handle CREATED_TIME and LAST_MODIFIED_TIME functions', async () => {
        await testFormulaExecution(
          'CREATED_TIME()',
          ['2024-01-10 08:00:00+00', '2024-01-12 15:30:00+00', '2024-01-15 10:30:00+00'],
          CellValueType.String
        );
        await testFormulaExecution(
          'LAST_MODIFIED_TIME()',
          ['2024-01-10 08:00:00+00', '2024-01-12 16:00:00+00', '2024-01-15 11:00:00+00'],
          CellValueType.String
        );
      });

      it('should handle RECORD_ID and AUTO_NUMBER functions', async () => {
        // These functions return system values from __id and __auto_number columns
        await testFormulaExecution('RECORD_ID()', ['rec1', 'rec2', 'rec3'], CellValueType.String);
        await testFormulaExecution('AUTO_NUMBER()', ['1', '2', '3']);
      });

      it.skip('should handle FROMNOW and TONOW functions', async () => {
        // Skip FROMNOW and TONOW - results unpredictable in generated columns
        console.log(
          'FROMNOW and TONOW functions test skipped - unpredictable results in generated columns'
        );
      });

      it.skip('should handle WORKDAY and WORKDAY_DIFF functions', async () => {
        // Skip WORKDAY functions - complex business day logic not implemented
        console.log('WORKDAY functions test skipped - complex business day logic not implemented');
      });
    });

    describe('Array and Aggregation Functions', () => {
      it('should handle COUNT functions', async () => {
        await testFormulaExecution(
          'COUNT({fld_number}, {fld_number_2})',
          ['2', '2', '2'],
          CellValueType.String
        );
        await testFormulaExecution(
          'COUNTA({fld_text}, {fld_text_2})',
          ['2', '2', '0'], // Empty strings are not counted
          CellValueType.String
        );
      });

      it('should handle COUNTALL function', async () => {
        await testFormulaExecution('COUNTALL({fld_number})', ['1', '1', '1'], CellValueType.String);
        await testFormulaExecution('COUNTALL({fld_text_2})', ['1', '1', '0'], CellValueType.String); // COUNTALL counts non-null values
      });

      it('should handle SUM function', async () => {
        await testFormulaExecution('SUM({fld_number}, {fld_number_2})', ['15', '5', '-2']);
        await testFormulaExecution('SUM(1, 2, 3)', ['6', '6', '6']);
      });

      it('should handle AVERAGE function', async () => {
        await testFormulaExecution('AVERAGE({fld_number}, {fld_number_2})', ['7.5', '2.5', '-1']);
        await testFormulaExecution('AVERAGE(1, 2, 3)', ['2', '2', '2']);
      });

      it('should fail ARRAY_JOIN function due to JSONB type mismatch', async () => {
        await expect(async () => {
          await testFormulaExecution(
            'ARRAY_JOIN({fld_array})',
            ['apple, banana, cherry', 'apple, banana, apple', ', test, , valid'],
            CellValueType.String
          );
        }).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: The query is empty]`);
      });

      it('should fail ARRAY_UNIQUE function due to subquery restriction', async () => {
        await expect(async () => {
          await testFormulaExecution(
            'ARRAY_UNIQUE({fld_array})',
            ['{apple,banana,cherry}', '{apple,banana}', '{"",test,valid}'],
            CellValueType.String
          );
        }).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: The query is empty]`);
      });

      it('should fail ARRAY_COMPACT function due to subquery restriction', async () => {
        await expect(async () => {
          await testFormulaExecution(
            'ARRAY_COMPACT({fld_array})',
            ['{apple,banana,cherry}', '{apple,banana,apple}', '{test,valid}'],
            CellValueType.String
          );
        }).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: The query is empty]`);
      });

      it('should fail ARRAY_FLATTEN function due to subquery restriction', async () => {
        await expect(async () => {
          await testFormulaExecution(
            'ARRAY_FLATTEN({fld_array})',
            ['{apple,banana,cherry}', '{apple,banana,apple}', '{"",test,valid}'],
            CellValueType.String
          );
        }).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: The query is empty]`);
      });
    });

    describe('Unsupported Functions', () => {
      const unsupportedFormulas = [
        // Date functions with column references are not immutable
        { formula: 'YEAR({fld_date})', type: CellValueType.Number },
        { formula: 'MONTH({fld_date})', type: CellValueType.Number },
        { formula: 'DAY({fld_date})', type: CellValueType.Number },
        { formula: 'HOUR({fld_date})', type: CellValueType.Number },
        { formula: 'MINUTE({fld_date})', type: CellValueType.Number },
        { formula: 'SECOND({fld_date})', type: CellValueType.Number },
        { formula: 'WEEKDAY({fld_date})', type: CellValueType.Number },
        { formula: 'WEEKNUM({fld_date})', type: CellValueType.Number },

        // Date formatting functions are not immutable
        { formula: 'TIMESTR({fld_date})', type: CellValueType.String },
        { formula: 'DATESTR({fld_date})', type: CellValueType.String },
        { formula: 'DATETIME_DIFF({fld_date}, {fld_date_2}, "days")', type: CellValueType.Number },
        { formula: 'IS_AFTER({fld_date}, {fld_date_2})', type: CellValueType.Number },
        { formula: 'DATETIME_FORMAT({fld_date}, "YYYY-MM-DD")', type: CellValueType.String },
        { formula: 'DATETIME_PARSE("2024-01-01", "YYYY-MM-DD")', type: CellValueType.String },

        // Array functions cause type mismatches
        { formula: 'ARRAY_JOIN({fld_text}, ",")', type: CellValueType.String },
        { formula: 'ARRAY_UNIQUE({fld_text})', type: CellValueType.String },
        { formula: 'ARRAY_COMPACT({fld_text})', type: CellValueType.String },
        { formula: 'ARRAY_FLATTEN({fld_text})', type: CellValueType.String },

        // String functions requiring collation are not supported
        { formula: 'UPPER({fld_text})', type: CellValueType.String },
        { formula: 'LOWER({fld_text})', type: CellValueType.String },
        { formula: 'FIND("e", {fld_text})', type: CellValueType.String },
        { formula: 'SUBSTITUTE({fld_text}, "e", "E")', type: CellValueType.String },
        { formula: 'REGEXP_REPLACE({fld_text}, "l+", "L")', type: CellValueType.String },

        // Other unsupported functions
        { formula: 'ENCODE_URL_COMPONENT({fld_text})', type: CellValueType.String },
        { formula: 'T({fld_number})', type: CellValueType.String },
        { formula: 'TEXT_ALL({fld_number})', type: CellValueType.String },
        { formula: 'TEXT_ALL({fld_text})', type: CellValueType.String },
      ];

      test.each(unsupportedFormulas)(
        'should return empty SQL for $formula',
        async ({ formula, type }) => {
          await testUnsupportedFormula(formula, type);
        }
      );
    });
  }
);
