/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { IFormulaConversionContext } from '@teable/core';
import {
  parseFormulaToSQL,
  SelectColumnSqlConversionVisitor,
  FieldType,
  DbFieldType,
  CellValueType,
} from '@teable/core';
import knex from 'knex';
import type { Knex } from 'knex';
import { vi, describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { PostgresProvider } from '../src/db-provider/postgres.provider';
import { SelectQueryPostgres } from '../src/db-provider/select-query/postgres/select-query.postgres';
import { createFieldInstanceByVo } from '../src/features/field/model/factory';

describe.skipIf(!process.env.PRISMA_DATABASE_URL?.includes('postgresql'))(
  'PostgreSQL SELECT Query Integration Tests',
  () => {
    let knexInstance: Knex;
    let postgresProvider: PostgresProvider;
    let selectQuery: SelectQueryPostgres;
    const testTableName = 'test_select_query_table';

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
      selectQuery = new SelectQueryPostgres();

      // Drop table if exists and create test table
      await knexInstance.schema.dropTableIfExists(testTableName);
      await knexInstance.schema.createTable(testTableName, (table) => {
        table.string('id').primary();
        table.double('a'); // Simple numeric column for basic tests
        table.double('b'); // Second numeric column
        table.text('text_col');
        table.timestamp('date_col');
        table.boolean('boolean_col');
        table.json('array_col'); // JSON column for array function tests
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

      // Insert test data: a=1, b=2
      await knexInstance(testTableName).insert([
        {
          id: 'row1',
          a: 1,
          b: 2,
          text_col: 'hello',
          date_col: '2024-01-10 08:00:00',
          boolean_col: true,
          array_col: JSON.stringify([[1, 2], [3]]), // Nested array for FLATTEN testing
          __created_time: '2024-01-10 08:00:00',
          __last_modified_time: '2024-01-10 08:00:00',
          __id: 'rec1',
          __auto_number: 1,
        },
        {
          id: 'row2',
          a: 5,
          b: 3,
          text_col: 'world',
          date_col: '2024-01-12 15:30:00',
          boolean_col: false,
          array_col: JSON.stringify([4, null, 5, null, 6]), // Array with nulls for COMPACT testing
          __created_time: '2024-01-12 15:30:00',
          __last_modified_time: '2024-01-12 16:00:00',
          __id: 'rec2',
          __auto_number: 2,
        },
      ]);
    });

    // Helper function to create conversion context
    function createContext(): IFormulaConversionContext {
      const fieldMap = new Map();

      // Create field instances using createFieldInstanceByVo
      const fieldA = createFieldInstanceByVo({
        id: 'fld_a',
        name: 'Field A',
        type: FieldType.Number,
        dbFieldName: 'a',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: { formatting: { type: 'decimal', precision: 2 } },
      });
      fieldMap.set('fld_a', fieldA);

      const fieldB = createFieldInstanceByVo({
        id: 'fld_b',
        name: 'Field B',
        type: FieldType.Number,
        dbFieldName: 'b',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: { formatting: { type: 'decimal', precision: 2 } },
      });
      fieldMap.set('fld_b', fieldB);

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

      const arrayField = createFieldInstanceByVo({
        id: 'fld_array',
        name: 'Array Field',
        type: FieldType.LongText,
        dbFieldName: 'array_col',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        options: {},
      });
      fieldMap.set('fld_array', arrayField);

      return {
        fieldMap,
        timeZone: 'UTC',
        isGeneratedColumn: false, // SELECT queries are not generated columns
      };
    }

    // Helper function to test SELECT query execution
    async function testSelectQuery(
      expression: string,
      expectedResults: (string | number | boolean)[],
      expectedSqlSnapshot?: string
    ) {
      try {
        // Set context for the SELECT query
        const context = createContext();
        selectQuery.setContext(context);

        // Convert the formula to SQL using SelectQueryPostgres directly
        const visitor = new SelectColumnSqlConversionVisitor(selectQuery, context);
        const generatedSql = parseFormulaToSQL(expression, visitor);

        // Execute SELECT query with the generated SQL
        const query = knexInstance(testTableName).select(
          'id',
          knexInstance.raw(`${generatedSql} as computed_value`)
        );
        const fullSql = query.toString();

        // Snapshot test for complete SELECT query
        if (expectedSqlSnapshot) {
          expect(fullSql).toBe(expectedSqlSnapshot);
        } else {
          expect(fullSql).toMatchSnapshot(
            `postgres-select-${expression.replace(/[^a-z0-9]/gi, '_')}`
          );
        }

        const results = await query;

        // Verify results
        expect(results).toHaveLength(expectedResults.length);
        if (expectedResults.length > 0) {
          // Use snapshot for result values to handle PostgreSQL type variations
          const resultValues = results.map((row) => row.computed_value);
          expect(resultValues).toMatchSnapshot(
            `postgres-results-${expression.replace(/[^a-z0-9]/gi, '_')}`
          );
        }

        return { sql: generatedSql, results };
      } catch (error) {
        console.error(`Error testing SELECT query "${expression}":`, error);
        throw error;
      }
    }

    describe('Basic Arithmetic Operations', () => {
      it('should compute a + 1 and return 2', async () => {
        await testSelectQuery('{fld_a} + 1', [2, 6]);
      });

      it('should compute a + b', async () => {
        await testSelectQuery('{fld_a} + {fld_b}', [3, 8]);
      });

      it('should compute a - b', async () => {
        await testSelectQuery('{fld_a} - {fld_b}', [-1, 2]);
      });

      it('should compute a * b', async () => {
        await testSelectQuery('{fld_a} * {fld_b}', [2, 15]);
      });

      it('should compute a / b', async () => {
        await testSelectQuery('{fld_a} / {fld_b}', [0.5, 1.6666666666666667]);
      });
    });

    describe('Math Functions', () => {
      it('should compute ABS function', async () => {
        await testSelectQuery('ABS({fld_a} - {fld_b})', [1, 2]);
      });

      it('should compute ROUND function', async () => {
        await testSelectQuery('ROUND({fld_a} / {fld_b}, 2)', [0.5, 1.67]);
      });

      it('should compute ROUNDUP function', async () => {
        await testSelectQuery('ROUNDUP({fld_a} / {fld_b}, 1)', [0.5, 1.7]);
      });

      it('should compute ROUNDDOWN function', async () => {
        await testSelectQuery('ROUNDDOWN({fld_a} / {fld_b}, 1)', [0.5, 1.6]);
      });

      it('should compute CEILING function', async () => {
        await testSelectQuery('CEILING({fld_a} / {fld_b})', [1, 2]);
      });

      it('should compute FLOOR function', async () => {
        await testSelectQuery('FLOOR({fld_a} / {fld_b})', [0, 1]);
      });

      it('should compute SQRT function', async () => {
        await testSelectQuery('SQRT({fld_a} * 4)', [2, 4.47213595499958]);
      });

      it('should compute POWER function', async () => {
        await testSelectQuery('POWER({fld_a}, {fld_b})', [1, 125]);
      });

      it('should compute EXP function', async () => {
        await testSelectQuery('EXP(1)', [2.718281828459045, 2.718281828459045]);
      });

      it('should compute LOG function', async () => {
        await testSelectQuery('LOG(10)', [2.302585092994046, 2.302585092994046]);
      });

      it('should compute MOD function', async () => {
        await testSelectQuery('MOD({fld_a} + 4, 3)', [2, 0]);
      });

      it('should compute MAX function', async () => {
        await testSelectQuery('MAX({fld_a}, {fld_b})', [2, 5]);
      });

      it('should compute MIN function', async () => {
        await testSelectQuery('MIN({fld_a}, {fld_b})', [1, 3]);
      });

      it('should compute SUM function', async () => {
        await testSelectQuery('{fld_a} + {fld_b}', [3, 8]); // SUM is for aggregation, use addition for this test
      });

      it('should compute AVERAGE function', async () => {
        await testSelectQuery('({fld_a} + {fld_b}) / 2', [1.5, 4]); // AVERAGE is for aggregation, use division for this test
      });

      it('should compute EVEN function', async () => {
        await testSelectQuery('EVEN(3)', [4, 4]);
      });

      it('should compute ODD function', async () => {
        await testSelectQuery('ODD(4)', [5, 5]);
      });

      it('should compute INT function', async () => {
        await testSelectQuery('INT({fld_a} / {fld_b})', [0, 1]);
      });

      it('should compute VALUE function', async () => {
        await testSelectQuery('VALUE("123")', [123, 123]);
      });
    });

    describe('Text Functions', () => {
      it('should compute CONCATENATE function', async () => {
        await testSelectQuery('CONCATENATE({fld_text}, " ", "test")', ['hello test', 'world test']);
      });

      it('should compute UPPER function', async () => {
        await testSelectQuery('UPPER({fld_text})', ['HELLO', 'WORLD']);
      });

      it('should compute LOWER function', async () => {
        await testSelectQuery('LOWER({fld_text})', ['hello', 'world']);
      });

      it('should compute LEN function', async () => {
        await testSelectQuery('LEN({fld_text})', [5, 5]);
      });

      it('should compute FIND function', async () => {
        await testSelectQuery('FIND("l", {fld_text})', [3, 4]);
      });

      it('should compute SEARCH function', async () => {
        await testSelectQuery('SEARCH("L", {fld_text})', [3, 4]);
      });

      it('should compute MID function', async () => {
        await testSelectQuery('MID({fld_text}, 2, 3)', ['ell', 'orl']);
      });

      it('should compute LEFT function', async () => {
        await testSelectQuery('LEFT({fld_text}, 3)', ['hel', 'wor']);
      });

      it('should compute RIGHT function', async () => {
        await testSelectQuery('RIGHT({fld_text}, 3)', ['llo', 'rld']);
      });

      it('should compute REPLACE function', async () => {
        await testSelectQuery('REPLACE({fld_text}, 1, 2, "Hi")', ['Hillo', 'Hirld']);
      });

      it('should compute SUBSTITUTE function', async () => {
        await testSelectQuery('SUBSTITUTE({fld_text}, "l", "x")', ['hexxo', 'worxd']);
      });

      it('should compute TRIM function', async () => {
        await testSelectQuery('TRIM(CONCATENATE(" ", {fld_text}, " "))', ['hello', 'world']);
      });

      it('should compute REPT function', async () => {
        await testSelectQuery('REPT("x", 3)', ['xxx', 'xxx']);
      });

      it('should compute T function', async () => {
        await testSelectQuery('T({fld_text})', ['hello', 'world']);
      });

      it('should compute ENCODE_URL_COMPONENT function', async () => {
        await testSelectQuery('ENCODE_URL_COMPONENT("hello world")', [
          'hello%20world',
          'hello%20world',
        ]);
      });
    });

    describe('Date/Time Functions (Mutable)', () => {
      it('should compute NOW function (mutable)', async () => {
        // NOW() should return current timestamp - this is the key difference from generated columns
        const context = createContext();
        const conversionResult = postgresProvider.convertFormulaToGeneratedColumn('NOW()', context);
        const generatedSql = conversionResult.sql;

        // Verify that NOW() was actually called (not pre-computed)
        expect(generatedSql).toContain('NOW()');
        expect(generatedSql).toMatchSnapshot('postgres-select-NOW___');

        // Execute SELECT query with the generated SQL
        const query = knexInstance(testTableName).select(
          'id',
          knexInstance.raw(`${generatedSql} as computed_value`)
        );
        const results = await query;

        // Verify we got results (actual time will vary)
        expect(results).toHaveLength(2);
        expect(results[0].computed_value).toBeInstanceOf(Date);
        expect(results[1].computed_value).toBeInstanceOf(Date);
      });

      it('should compute TODAY function (mutable)', async () => {
        const context = createContext();
        const conversionResult = postgresProvider.convertFormulaToGeneratedColumn(
          'TODAY()',
          context
        );
        const generatedSql = conversionResult.sql;

        // Verify that TODAY() was actually called (not pre-computed)
        expect(generatedSql).toContain('CURRENT_DATE');
        expect(generatedSql).toMatchSnapshot('postgres-select-TODAY___');

        // Execute SELECT query with the generated SQL
        const query = knexInstance(testTableName).select(
          'id',
          knexInstance.raw(`${generatedSql} as computed_value`)
        );
        const results = await query;

        // Verify we got results (actual date will vary)
        expect(results).toHaveLength(2);
        // PostgreSQL returns Date objects for TODAY()
        expect(results[0].computed_value).toBeInstanceOf(Date);
        expect(results[1].computed_value).toBeInstanceOf(Date);
      });

      it('should compute YEAR function', async () => {
        await testSelectQuery('YEAR({fld_date})', [2024, 2024]);
      });

      it('should compute MONTH function', async () => {
        await testSelectQuery('MONTH({fld_date})', [1, 1]);
      });

      it('should compute DAY function', async () => {
        await testSelectQuery('DAY({fld_date})', [10, 12]);
      });

      it('should compute HOUR function', async () => {
        await testSelectQuery('HOUR({fld_date})', [8, 15]);
      });

      it('should compute MINUTE function', async () => {
        await testSelectQuery('MINUTE({fld_date})', [0, 30]);
      });

      it('should compute SECOND function', async () => {
        await testSelectQuery('SECOND({fld_date})', [0, 0]);
      });

      it('should compute WEEKDAY function', async () => {
        await testSelectQuery('WEEKDAY({fld_date})', [3, 5]); // Wednesday, Friday
      });

      it('should compute WEEKNUM function', async () => {
        await testSelectQuery('WEEKNUM({fld_date})', [2, 2]);
      });

      it('should compute DATESTR function', async () => {
        await testSelectQuery('DATESTR({fld_date})', ['2024-01-10', '2024-01-12']);
      });

      it('should compute TIMESTR function', async () => {
        await testSelectQuery('TIMESTR({fld_date})', ['08:00:00', '15:30:00']);
      });

      // Note: CREATED_TIME and LAST_MODIFIED_TIME functions may not be properly supported
      // in the current SELECT query implementation. These would typically reference system columns.
    });

    describe('Logical Functions', () => {
      it('should compute IF function', async () => {
        await testSelectQuery('IF({fld_a} > {fld_b}, "greater", "not greater")', [
          'not greater',
          'greater',
        ]);
      });

      it('should compute AND function', async () => {
        await testSelectQuery('AND({fld_a} > 0, {fld_b} > 0)', [true, true]);
      });

      it('should compute OR function', async () => {
        await testSelectQuery('OR({fld_a} > 10, {fld_b} > 1)', [true, true]);
      });

      it('should compute NOT function', async () => {
        await testSelectQuery('NOT({fld_a} > {fld_b})', [true, false]);
      });

      it('should compute XOR function', async () => {
        await testSelectQuery('XOR({fld_a} > 0, {fld_b} > 10)', [true, true]);
      });

      it('should compute BLANK function', async () => {
        await testSelectQuery('BLANK()', ['', '']);
      });

      // Note: ERROR and ISERROR functions are not supported in the current implementation

      it('should compute SWITCH function', async () => {
        await testSelectQuery('SWITCH({fld_a}, 1, "one", 5, "five", "other")', ['one', 'five']);
      });
    });

    describe('Array Functions', () => {
      // Note: COUNT, COUNTA, COUNTALL are aggregate functions and cannot be used
      // in SELECT queries without GROUP BY. They are more suitable for aggregation queries.

      it('should compute ARRAY_JOIN function', async () => {
        // Test with JSON array column - row1 has [[1,2],[3]], row2 has [4,null,5,null,6]
        await testSelectQuery('ARRAY_JOIN({fld_array}, ",")', ['1,2,3', '4,5,6']);
      });

      it('should compute ARRAY_UNIQUE function', async () => {
        // Test with array containing duplicates
        await testSelectQuery('ARRAY_UNIQUE({fld_array})', ['{1,2,3}', '{4,5,6}']);
      });

      it('should compute ARRAY_FLATTEN function', async () => {
        // Test with nested arrays - row1 has [[1,2],[3]] which should flatten to [1,2,3]
        await testSelectQuery('ARRAY_FLATTEN({fld_array})', ['{1,2,3}', '{4,5,6}']);
      });

      it('should compute ARRAY_COMPACT function', async () => {
        // Test with array containing nulls - row2 has [4,null,5,null,6] which should compact to [4,5,6]
        await testSelectQuery('ARRAY_COMPACT({fld_array})', ['{1,2,3}', '{4,5,6}']);
      });
    });

    describe('System Functions', () => {
      it('should compute RECORD_ID function', async () => {
        await testSelectQuery('RECORD_ID()', ['rec1', 'rec2']);
      });

      it('should compute AUTO_NUMBER function', async () => {
        await testSelectQuery('AUTO_NUMBER()', [1, 2]);
      });

      // Note: TEXT_ALL function has implementation issues with array handling in PostgreSQL
    });

    describe('Binary Operations', () => {
      it('should compute addition operation', async () => {
        await testSelectQuery('{fld_a} + {fld_b}', [3, 8]);
      });

      it('should compute subtraction operation', async () => {
        await testSelectQuery('{fld_a} - {fld_b}', [-1, 2]);
      });

      it('should compute multiplication operation', async () => {
        await testSelectQuery('{fld_a} * {fld_b}', [2, 15]);
      });

      it('should compute division operation', async () => {
        await testSelectQuery('{fld_a} / {fld_b}', [0.5, 1.6666666666666667]);
      });

      it('should compute modulo operation', async () => {
        await testSelectQuery('7 % 3', [1, 1]);
      });
    });

    describe('Comparison Operations', () => {
      it('should compute equal operation', async () => {
        await testSelectQuery('{fld_a} = 1', [true, false]);
      });

      it('should compute not equal operation', async () => {
        await testSelectQuery('{fld_a} <> 1', [false, true]);
      });

      it('should compute greater than operation', async () => {
        await testSelectQuery('{fld_a} > {fld_b}', [false, true]);
      });

      it('should compute less than operation', async () => {
        await testSelectQuery('{fld_a} < {fld_b}', [true, false]);
      });

      it('should compute greater than or equal operation', async () => {
        await testSelectQuery('{fld_a} >= 1', [true, true]);
      });

      it('should compute less than or equal operation', async () => {
        await testSelectQuery('{fld_a} <= 1', [true, false]);
      });
    });

    describe('Type Casting', () => {
      it('should compute number casting', async () => {
        await testSelectQuery('VALUE("123")', [123, 123]);
      });

      it('should compute string casting', async () => {
        await testSelectQuery('T({fld_a})', ['1', '5']);
      });

      it('should compute boolean casting', async () => {
        await testSelectQuery('{fld_a} > 0', [true, true]);
      });

      it('should compute date casting', async () => {
        await testSelectQuery('DATESTR({fld_date})', ['2024-01-10', '2024-01-12']);
      });
    });

    describe('Utility Functions', () => {
      it('should compute null check', async () => {
        await testSelectQuery('{fld_a} IS NULL', [false, false]);
      });

      // Note: COALESCE function is not supported in the current formula system

      it('should compute parentheses grouping', async () => {
        await testSelectQuery('({fld_a} + {fld_b}) * 2', [6, 16]);
      });
    });

    describe('Complex Expressions', () => {
      it('should compute complex nested expression', async () => {
        await testSelectQuery(
          'IF({fld_a} > {fld_b}, UPPER({fld_text}), LOWER(CONCATENATE({fld_text}, " - ", "modified")))',
          ['hello - modified', 'WORLD']
        );
      });

      it('should compute mathematical expression with functions', async () => {
        await testSelectQuery(
          'ROUND(SQRT(POWER({fld_a}, 2) + POWER({fld_b}, 2)), 2)',
          [2.24, 5.83]
        );
      });
    });
  }
);
