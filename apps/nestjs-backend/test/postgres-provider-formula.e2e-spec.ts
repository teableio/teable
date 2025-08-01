/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import { FieldType, DbFieldType, CellValueType } from '@teable/core';
import { plainToInstance } from 'class-transformer';
import knex from 'knex';
import type { Knex } from 'knex';
import { vi, describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import type { IFormulaConversionContext } from '../src/db-provider/generated-column-query/generated-column-query.interface';
import { PostgresProvider } from '../src/db-provider/postgres.provider';
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
      return {
        fieldMap: {
          fld_number: {
            columnName: 'number_col',
            fieldType: 'Number',
          },
          fld_text: {
            columnName: 'text_col',
            fieldType: 'SingleLineText',
          },
          fld_date: {
            columnName: 'date_col',
            fieldType: 'Date',
          },
          fld_boolean: {
            columnName: 'boolean_col',
            fieldType: 'Checkbox',
          },
          fld_number_2: {
            columnName: 'number_col_2',
            fieldType: 'Number',
          },
          fld_text_2: {
            columnName: 'text_col_2',
            fieldType: 'SingleLineText',
          },
          fld_array: {
            columnName: 'array_col',
            fieldType: 'MultipleSelect',
          },
        },
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
        expect(results).toHaveLength(expectedResults.length);
        results.forEach((row, index) => {
          expect(row[generatedColumnName]).toEqual(expectedResults[index]);
        });

        // Clean up: drop the generated column for next test (use lowercase for PostgreSQL)
        const cleanupColumnName = generatedColumnName.toLowerCase();
        await knexInstance.raw(`ALTER TABLE ${testTableName} DROP COLUMN "${cleanupColumnName}"`);
      } catch (error) {
        console.error(`Error testing formula "${expression}":`, error);
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
        await testFormulaExecution('ROUND(3.14159, 2)', [3.14, 3.14, 3.14]);
        await testFormulaExecution('ROUND({fld_number} / 3, 1)', [3.3, -1.0, 0.0]);
      });

      it('should handle CEILING and FLOOR functions', async () => {
        await testFormulaExecution('CEILING(3.14)', [4, 4, 4]);
        await testFormulaExecution('FLOOR(3.99)', [3, 3, 3]);
      });

      it('should handle SQRT and POWER functions', async () => {
        await testFormulaExecution('SQRT(16)', [4, 4, 4]);
        await testFormulaExecution('POWER(2, 3)', [8, 8, 8]);
      });

      it('should handle MAX and MIN functions', async () => {
        await testFormulaExecution('MAX({fld_number}, {fld_number_2})', [10, 8, 0]);
        await testFormulaExecution('MIN({fld_number}, {fld_number_2})', [5, -3, -2]);
      });

      it('should handle ROUNDUP and ROUNDDOWN functions', async () => {
        await testFormulaExecution('ROUNDUP(3.14159, 2)', [3.15, 3.15, 3.15]);
        await testFormulaExecution('ROUNDDOWN(3.99999, 2)', [3.99, 3.99, 3.99]);
      });

      it('should handle EVEN and ODD functions', async () => {
        await testFormulaExecution('EVEN(3)', [4, 4, 4]);
        await testFormulaExecution('ODD(4)', [5, 5, 5]);
      });

      it('should handle INT function', async () => {
        await testFormulaExecution('INT(3.99)', [3, 3, 3]);
        await testFormulaExecution('INT(-2.5)', [-2, -2, -2]);
      });

      it('should handle EXP and LOG functions', async () => {
        await testFormulaExecution(
          'EXP(1)',
          [2.718281828459045, 2.718281828459045, 2.718281828459045]
        );
        await testFormulaExecution('LOG(2.718281828459045)', [1, 1, 1]);
      });

      it('should handle MOD function', async () => {
        await testFormulaExecution('MOD(10, 3)', [1, 1, 1]);
        await testFormulaExecution('MOD({fld_number}, 3)', [1, 0, 0]);
      });

      it('should handle SUM function', async () => {
        await testFormulaExecution('SUM({fld_number}, {fld_number_2})', [15, 5, -2]);
        await testFormulaExecution('SUM(1, 2, 3)', [6, 6, 6]);
      });

      it('should handle AVERAGE function', async () => {
        await testFormulaExecution('AVERAGE({fld_number}, {fld_number_2})', [7.5, 2.5, -1]);
        await testFormulaExecution('AVERAGE(1, 2, 3)', [2, 2, 2]);
      });

      it('should handle VALUE function', async () => {
        await testFormulaExecution('VALUE("123")', [123, 123, 123]);
        await testFormulaExecution('VALUE("45.67")', [45.67, 45.67, 45.67]);
      });
    });

    describe('String Functions', () => {
      it('should handle CONCATENATE function', async () => {
        await testFormulaExecution(
          'CONCATENATE({fld_text}, " ", {fld_text_2})',
          ['hello world', 'test data', ' '],
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
        await testFormulaExecution('LEN({fld_text})', [5, 4, 0]);
        await testFormulaExecution('LEN("test")', [4, 4, 4]);
      });

      it('should handle UPPER and LOWER functions', async () => {
        await testFormulaExecution(
          'UPPER({fld_text})',
          ['HELLO', 'TEST', ''],
          CellValueType.String
        );
        await testFormulaExecution(
          'LOWER("HELLO")',
          ['hello', 'hello', 'hello'],
          CellValueType.String
        );
      });

      it('should handle TRIM function', async () => {
        await testFormulaExecution(
          'TRIM("  hello  ")',
          ['hello', 'hello', 'hello'],
          CellValueType.String
        );
      });

      it('should handle FIND and SEARCH functions', async () => {
        await testFormulaExecution('FIND("l", "hello")', [3, 3, 3]);
        await testFormulaExecution('SEARCH("L", "hello")', [3, 3, 3]);
      });

      it('should handle REPLACE function', async () => {
        await testFormulaExecution(
          'REPLACE("hello", 2, 2, "i")',
          ['hilo', 'hilo', 'hilo'],
          CellValueType.String
        );
      });

      it('should handle SUBSTITUTE function', async () => {
        await testFormulaExecution(
          'SUBSTITUTE("hello world", "l", "x")',
          ['hexxo worxd', 'hexxo worxd', 'hexxo worxd'],
          CellValueType.String
        );
      });

      it('should handle REPT function', async () => {
        await testFormulaExecution('REPT("a", 3)', ['aaa', 'aaa', 'aaa'], CellValueType.String);
      });

      it('should handle REGEXP_REPLACE function', async () => {
        await testFormulaExecution(
          'REGEXP_REPLACE("hello123", "[0-9]+", "world")',
          ['helloworld', 'helloworld', 'helloworld'],
          CellValueType.String
        );
      });

      it('should handle ENCODE_URL_COMPONENT function', async () => {
        await testFormulaExecution(
          'ENCODE_URL_COMPONENT("hello world")',
          ['hello%20world', 'hello%20world', 'hello%20world'],
          CellValueType.String
        );
      });

      it('should handle T function', async () => {
        await testFormulaExecution('T({fld_text})', ['hello', 'test', ''], CellValueType.String);
        await testFormulaExecution('T({fld_number})', ['', '', ''], CellValueType.String);
      });
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
        await testFormulaExecution('AND({fld_boolean}, {fld_number} > 0)', [1, 0, 0]);
        await testFormulaExecution('OR({fld_boolean}, {fld_number} > 0)', [1, 0, 1]);
      });

      it('should handle NOT function', async () => {
        await testFormulaExecution('NOT({fld_boolean})', [0, 1, 0]);
      });

      it('should handle XOR function', async () => {
        await testFormulaExecution('XOR({fld_boolean}, {fld_number} > 0)', [0, 0, 1]);
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
        }).rejects.toThrowErrorMatchingInlineSnapshot();
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
        }).rejects.toThrowErrorMatchingInlineSnapshot();
      });
    });

    describe('Column References', () => {
      it('should handle single column references', async () => {
        await testFormulaExecution('{fld_number}', [10, -3, 0]);
        await testFormulaExecution('{fld_text}', ['hello', 'test', ''], CellValueType.String);
      });

      it('should handle arithmetic with column references', async () => {
        await testFormulaExecution('{fld_number} + {fld_number_2}', [15, 5, -2]);
        await testFormulaExecution('{fld_number} * 2', [20, -6, 0]);
      });

      it('should handle string operations with column references', async () => {
        await testFormulaExecution(
          'CONCATENATE({fld_text}, "-", {fld_text_2})',
          ['hello-world', 'test-data', '-'],
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

      it('should handle date extraction functions', async () => {
        await testFormulaExecution('YEAR("2024-01-15")', [2024, 2024, 2024]);
        await testFormulaExecution('MONTH("2024-01-15")', [1, 1, 1]);
        await testFormulaExecution('DAY("2024-01-15")', [15, 15, 15]);
      });

      it('should handle date extraction from column references', async () => {
        await testFormulaExecution('YEAR({fld_date})', [2024, 2024, 2024]);
        await testFormulaExecution('MONTH({fld_date})', [1, 1, 1]);
        await testFormulaExecution('DAY({fld_date})', [10, 12, 15]);
      });

      it('should handle time extraction functions', async () => {
        await testFormulaExecution('HOUR({fld_date})', [8, 15, 10]);
        await testFormulaExecution('MINUTE({fld_date})', [0, 30, 30]);
        await testFormulaExecution('SECOND({fld_date})', [0, 0, 0]);
      });

      it('should handle WEEKDAY function', async () => {
        await testFormulaExecution('WEEKDAY({fld_date})', [4, 6, 2]); // Wednesday, Friday, Monday
      });

      it('should handle WEEKNUM function', async () => {
        await testFormulaExecution('WEEKNUM({fld_date})', [2, 2, 3]);
      });

      it('should handle TIMESTR function', async () => {
        await testFormulaExecution(
          'TIMESTR({fld_date})',
          ['08:00:00', '15:30:00', '10:30:00'],
          CellValueType.String
        );
      });

      it('should handle DATESTR function', async () => {
        await testFormulaExecution(
          'DATESTR({fld_date})',
          ['2024-01-10', '2024-01-12', '2024-01-15'],
          CellValueType.String
        );
      });

      it('should handle DATETIME_DIFF function', async () => {
        await testFormulaExecution('DATETIME_DIFF("2024-01-01", {fld_date}, "days")', [9, 11, 14]);
      });

      it('should handle IS_AFTER, IS_BEFORE, IS_SAME functions', async () => {
        await testFormulaExecution('IS_AFTER({fld_date}, "2024-01-01")', [1, 1, 1]);
        await testFormulaExecution('IS_BEFORE({fld_date}, "2024-01-20")', [1, 1, 1]);
        await testFormulaExecution('IS_SAME({fld_date}, "2024-01-10", "day")', [1, 0, 0]);
      });

      it('should handle DATETIME_FORMAT function', async () => {
        await testFormulaExecution(
          'DATETIME_FORMAT({fld_date}, "YYYY-MM-DD")',
          ['2024-01-10', '2024-01-12', '2024-01-15'],
          CellValueType.String
        );
      });

      it('should handle DATE_ADD function', async () => {
        await testFormulaExecution(
          'DATE_ADD({fld_date}, 5, "days")',
          ['2024-01-15', '2024-01-17', '2024-01-20'],
          CellValueType.String
        );
        await testFormulaExecution(
          'DATE_ADD("2024-01-10", 2, "months")',
          ['2024-03-10', '2024-03-10', '2024-03-10'],
          CellValueType.String
        );
      });

      it('should handle DATETIME_PARSE function', async () => {
        await testFormulaExecution(
          'DATETIME_PARSE("2024-01-10 08:00:00", "YYYY-MM-DD HH:mm:ss")',
          ['2024-01-10 08:00:00', '2024-01-10 08:00:00', '2024-01-10 08:00:00'],
          CellValueType.String
        );
      });

      it('should handle CREATED_TIME and LAST_MODIFIED_TIME functions', async () => {
        await testFormulaExecution(
          'CREATED_TIME()',
          ['2024-01-10 08:00:00', '2024-01-12 15:30:00', '2024-01-15 10:30:00'],
          CellValueType.String
        );
        await testFormulaExecution(
          'LAST_MODIFIED_TIME()',
          ['2024-01-10 08:00:00', '2024-01-12 16:00:00', '2024-01-15 11:00:00'],
          CellValueType.String
        );
      });

      it('should handle RECORD_ID and AUTO_NUMBER functions', async () => {
        // These functions return system values from __id and __auto_number columns
        await testFormulaExecution('RECORD_ID()', ['rec1', 'rec2', 'rec3'], CellValueType.String);
        await testFormulaExecution('AUTO_NUMBER()', [1, 2, 3]);
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
          ['2', '2', '1'],
          CellValueType.String
        );
      });

      it('should handle COUNTALL function', async () => {
        await testFormulaExecution('COUNTALL({fld_number})', ['1', '1', '1'], CellValueType.String);
        await testFormulaExecution('COUNTALL({fld_text_2})', ['1', '1', '0'], CellValueType.String);
      });

      it('should fail ARRAY_JOIN function due to JSONB type mismatch', async () => {
        await expect(async () => {
          await testFormulaExecution(
            'ARRAY_JOIN({fld_array})',
            ['apple, banana, cherry', 'apple, banana, apple', ', test, , valid'],
            CellValueType.String
          );
        }).rejects.toThrowErrorMatchingInlineSnapshot(
          `[error: alter table "test_formula_table" add column "fld_test_field_67" text, add column "fld_test_field_67___generated" TEXT GENERATED ALWAYS AS (ARRAY_TO_STRING("array_col", ', ')) STORED - function array_to_string(jsonb, unknown) does not exist]`
        );
      });

      it('should fail ARRAY_UNIQUE function due to subquery restriction', async () => {
        await expect(async () => {
          await testFormulaExecution(
            'ARRAY_UNIQUE({fld_array})',
            ['{apple,banana,cherry}', '{apple,banana}', '{"",test,valid}'],
            CellValueType.String
          );
        }).rejects.toThrowErrorMatchingInlineSnapshot(
          `[error: alter table "test_formula_table" add column "fld_test_field_68" text, add column "fld_test_field_68___generated" TEXT GENERATED ALWAYS AS (ARRAY(SELECT DISTINCT UNNEST("array_col"))) STORED - cannot use subquery in column generation expression]`
        );
      });

      it('should fail ARRAY_COMPACT function due to subquery restriction', async () => {
        await expect(async () => {
          await testFormulaExecution(
            'ARRAY_COMPACT({fld_array})',
            ['{apple,banana,cherry}', '{apple,banana,apple}', '{test,valid}'],
            CellValueType.String
          );
        }).rejects.toThrowErrorMatchingInlineSnapshot(
          `[error: alter table "test_formula_table" add column "fld_test_field_69" text, add column "fld_test_field_69___generated" TEXT GENERATED ALWAYS AS (ARRAY(SELECT x FROM UNNEST("array_col") AS x WHERE x IS NOT NULL)) STORED - cannot use subquery in column generation expression]`
        );
      });

      it('should fail ARRAY_FLATTEN function due to subquery restriction', async () => {
        await expect(async () => {
          await testFormulaExecution(
            'ARRAY_FLATTEN({fld_array})',
            ['{apple,banana,cherry}', '{apple,banana,apple}', '{"",test,valid}'],
            CellValueType.String
          );
        }).rejects.toThrowErrorMatchingInlineSnapshot(
          `[error: alter table "test_formula_table" add column "fld_test_field_70" text, add column "fld_test_field_70___generated" TEXT GENERATED ALWAYS AS (ARRAY(SELECT UNNEST("array_col"))) STORED - cannot use subquery in column generation expression]`
        );
      });
    });

    describe('System Functions', () => {
      it('should handle TEXT_ALL function', async () => {
        await testFormulaExecution(
          'TEXT_ALL({fld_number})',
          ['10', '-3', '0'],
          CellValueType.String
        );
        await testFormulaExecution(
          'TEXT_ALL({fld_text})',
          ['hello', 'test', ''],
          CellValueType.String
        );
      });
    });
  }
);
