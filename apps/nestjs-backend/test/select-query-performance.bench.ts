/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { IFormulaConversionContext } from '@teable/core';
import {
  parseFormulaToSQL,
  SelectColumnSqlConversionVisitor,
  FieldType,
  DbFieldType,
  CellValueType,
  Colors,
  NumberFormattingType,
} from '@teable/core';
import type { Knex } from 'knex';
import knex from 'knex';
import { describe, bench, beforeAll, afterAll } from 'vitest';
import { SelectQueryPostgres } from '../src/db-provider/select-query/postgres/select-query.postgres';
import { createFieldInstanceByVo } from '../src/features/field/model/factory';

// Test configuration
const RECORD_COUNT = 50000;
const BATCH_SIZE = 1000;
const QUERY_LIMIT = 500;
const TABLE_NAME = 'select_query_perf_test';

// Global test state
let knexInstance: Knex;
let selectQuery: SelectQueryPostgres;
let context: IFormulaConversionContext;
let isSetupComplete = false;

// Helper function to create field instances for testing
function createTestFields() {
  const fieldMap = new Map();

  // Basic data type fields
  const textField = createFieldInstanceByVo({
    id: 'fld_text',
    name: 'Text Field',
    type: FieldType.SingleLineText,
    dbFieldName: 'fld_text',
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    options: {},
  });

  const longTextField = createFieldInstanceByVo({
    id: 'fld_long_text',
    name: 'Long Text Field',
    type: FieldType.LongText,
    dbFieldName: 'fld_long_text',
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    options: {},
  });

  const numberField = createFieldInstanceByVo({
    id: 'fld_number',
    name: 'Number Field',
    type: FieldType.Number,
    dbFieldName: 'fld_number',
    dbFieldType: DbFieldType.Real,
    cellValueType: CellValueType.Number,
    options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
  });

  const ratingField = createFieldInstanceByVo({
    id: 'fld_rating',
    name: 'Rating Field',
    type: FieldType.Rating,
    dbFieldName: 'fld_rating',
    dbFieldType: DbFieldType.Real,
    cellValueType: CellValueType.Number,
    options: { max: 5 },
  });

  const dateField = createFieldInstanceByVo({
    id: 'fld_date',
    name: 'Date Field',
    type: FieldType.Date,
    dbFieldName: 'fld_date',
    dbFieldType: DbFieldType.DateTime,
    cellValueType: CellValueType.DateTime,
    options: {},
  });

  const checkboxField = createFieldInstanceByVo({
    id: 'fld_checkbox',
    name: 'Checkbox Field',
    type: FieldType.Checkbox,
    dbFieldName: 'fld_checkbox',
    dbFieldType: DbFieldType.Boolean,
    cellValueType: CellValueType.Boolean,
    options: {},
  });

  const singleSelectField = createFieldInstanceByVo({
    id: 'fld_single_select',
    name: 'Single Select Field',
    type: FieldType.SingleSelect,
    dbFieldName: 'fld_single_select',
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    options: {
      choices: [
        { name: 'Option A', color: Colors.Red },
        { name: 'Option B', color: Colors.Blue },
        { name: 'Option C', color: Colors.Green },
      ],
    },
  });

  // Add all fields to the map
  fieldMap.set('fld_text', textField);
  fieldMap.set('fld_long_text', longTextField);
  fieldMap.set('fld_number', numberField);
  fieldMap.set('fld_rating', ratingField);
  fieldMap.set('fld_date', dateField);
  fieldMap.set('fld_checkbox', checkboxField);
  fieldMap.set('fld_single_select', singleSelectField);

  return fieldMap;
}

// Helper function to setup database and test data
async function setupTestDatabase(): Promise<void> {
  if (isSetupComplete) return;

  console.log(`🚀 Setting up SELECT query performance test...`);

  // Create Knex instance
  const databaseUrl = process.env.PRISMA_DATABASE_URL;
  if (!databaseUrl?.includes('postgresql')) {
    throw new Error('PostgreSQL database URL not found in environment');
  }

  knexInstance = knex({
    client: 'pg',
    connection: databaseUrl,
  });

  selectQuery = new SelectQueryPostgres();

  // Create field context
  const fieldMap = createTestFields();
  context = { fieldMap };

  try {
    // Clean up existing table
    await knexInstance.schema.dropTableIfExists(TABLE_NAME);
    console.log(`🧹 Cleaned up existing table ${TABLE_NAME}`);

    // Create test table with 20 columns
    await knexInstance.schema.createTable(TABLE_NAME, (table) => {
      table.text('id').primary();

      // Basic data type columns (12 columns)
      table.text('fld_text');
      table.text('fld_long_text');
      table.double('fld_number');
      table.double('fld_rating');
      table.timestamp('fld_date');
      table.boolean('fld_checkbox');
      table.text('fld_single_select');
      table.text('fld_text_2');
      table.double('fld_number_2');
      table.timestamp('fld_date_2');
      table.boolean('fld_checkbox_2');
      table.text('fld_category');

      // System columns
      table.timestamp('__created_time').defaultTo(knexInstance.fn.now());
      table.timestamp('__last_modified_time').defaultTo(knexInstance.fn.now());
      table.text('__id');
      table.integer('__auto_number');
    });

    console.log(`📋 Created table ${TABLE_NAME} with 20 columns`);
    console.log(`📊 Generating ${RECORD_COUNT} test records...`);

    // Generate test data in batches
    const totalBatches = Math.ceil(RECORD_COUNT / BATCH_SIZE);
    const categories = ['Category A', 'Category B', 'Category C', 'Category D'];
    const selectOptions = ['Option A', 'Option B', 'Option C'];

    for (let batch = 0; batch < totalBatches; batch++) {
      const batchData = [];
      const startIdx = batch * BATCH_SIZE;
      const endIdx = Math.min(startIdx + BATCH_SIZE, RECORD_COUNT);

      for (let i = startIdx; i < endIdx; i++) {
        const baseDate = new Date(2024, 0, 1);
        const randomDays = Math.floor(Math.random() * 365);
        const recordDate = new Date(baseDate.getTime() + randomDays * 24 * 60 * 60 * 1000);

        batchData.push({
          id: `rec_${i.toString().padStart(8, '0')}`,
          fld_text: `Sample text ${i}`,
          fld_long_text: `This is a longer text sample for record ${i}. It contains more detailed information.`,
          fld_number: Math.floor(Math.random() * 1000) + 1,
          fld_rating: Math.floor(Math.random() * 5) + 1,
          fld_date: recordDate,
          fld_checkbox: i % 2 === 0,
          fld_single_select: selectOptions[i % selectOptions.length],
          fld_text_2: `Secondary text ${i}`,
          fld_number_2: Math.floor(Math.random() * 500) + 1,
          fld_date_2: new Date(recordDate.getTime() + Math.random() * 30 * 24 * 60 * 60 * 1000),
          fld_checkbox_2: i % 3 === 0,
          fld_category: categories[i % categories.length],
          __created_time: recordDate,
          __last_modified_time: recordDate,
          __id: `sys_rec_${i}`,
          __auto_number: i + 1,
        });
      }

      await knexInstance(TABLE_NAME).insert(batchData);

      // Log progress every 10 batches
      if ((batch + 1) % 10 === 0 || batch === totalBatches - 1) {
        console.log(
          `📝 Inserted batch ${batch + 1}/${totalBatches} (${endIdx}/${RECORD_COUNT} records)`
        );
      }
    }

    // Verify record count
    const actualCount = await knexInstance(TABLE_NAME).count('* as count').first();
    const count = Number(actualCount?.count);
    if (count !== RECORD_COUNT) {
      throw new Error(`Expected ${RECORD_COUNT} records, but found ${count}`);
    }

    console.log(
      `✅ Successfully created ${RECORD_COUNT} records for SELECT query performance test`
    );
    isSetupComplete = true;
  } catch (error) {
    console.error(`❌ Failed to setup test database:`, error);
    throw error;
  }
}

// Helper function to execute formula query with performance measurement
async function executeFormulaQuery(
  formula: string
): Promise<{ result: unknown[]; executionTime: number }> {
  const startTime = Date.now();

  // Parse formula to SQL using SelectQueryPostgres
  const visitor = new SelectColumnSqlConversionVisitor(selectQuery, context);
  const sqlResult = parseFormulaToSQL(formula, visitor);

  // Build and execute query
  const query = knexInstance(TABLE_NAME)
    .select('id')
    .select(knexInstance.raw(`(${sqlResult}) as formula_result`))
    .limit(QUERY_LIMIT);

  const result = await query;
  const executionTime = Date.now() - startTime;

  return { result, executionTime };
}

describe.skipIf(!process.env.PRISMA_DATABASE_URL?.includes('postgresql'))(
  'SELECT Query Performance Benchmarks',
  () => {
    beforeAll(async () => {
      await setupTestDatabase();
    });

    afterAll(async () => {
      if (knexInstance) {
        await knexInstance.schema.dropTableIfExists(TABLE_NAME);
        await knexInstance.destroy();
      }
    });

    // Simple Formula Benchmarks
    describe('Simple Formula Performance', () => {
      bench(
        'Simple arithmetic: {fld_number} + 100',
        async () => {
          const { result, executionTime } = await executeFormulaQuery('{fld_number} + 100');
          console.log(
            `📊 Simple arithmetic executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 10,
          time: 5000,
        }
      );

      bench(
        'String function: UPPER({fld_text})',
        async () => {
          const { result, executionTime } = await executeFormulaQuery('UPPER({fld_text})');
          console.log(
            `📊 String function executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 10,
          time: 5000,
        }
      );

      bench(
        'Math function: ROUND({fld_number}, 2)',
        async () => {
          const { result, executionTime } = await executeFormulaQuery('ROUND({fld_number}, 2)');
          console.log(
            `📊 Math function executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 10,
          time: 5000,
        }
      );
    });

    // Medium Complexity Formula Benchmarks
    describe('Medium Complexity Formula Performance', () => {
      bench(
        'Multi-field arithmetic: {fld_number} * {fld_rating}',
        async () => {
          const { result, executionTime } = await executeFormulaQuery(
            '{fld_number} * {fld_rating}'
          );
          console.log(
            `📊 Multi-field arithmetic executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 8,
          time: 8000,
        }
      );

      bench(
        'Conditional logic: IF({fld_number} > 500, "High", "Low")',
        async () => {
          const { result, executionTime } = await executeFormulaQuery(
            'IF({fld_number} > 500, "High", "Low")'
          );
          console.log(
            `📊 Conditional logic executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 8,
          time: 8000,
        }
      );

      bench(
        'String concatenation: CONCATENATE({fld_text}, " - ", {fld_number})',
        async () => {
          const { result, executionTime } = await executeFormulaQuery(
            'CONCATENATE({fld_text}, " - ", {fld_number})'
          );
          console.log(
            `📊 String concatenation executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 8,
          time: 8000,
        }
      );
    });

    // Complex Formula Benchmarks
    describe('Complex Formula Performance', () => {
      bench(
        'Nested functions: ROUND(({fld_number} * 2) + ({fld_rating} / 3), 2)',
        async () => {
          const { result, executionTime } = await executeFormulaQuery(
            'ROUND(({fld_number} * 2) + ({fld_rating} / 3), 2)'
          );
          console.log(
            `📊 Nested functions executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 5,
          time: 10000,
        }
      );

      bench(
        'Complex conditional: IF(AND({fld_number} > 100, {fld_checkbox}), {fld_number} * 2, {fld_number} / 2)',
        async () => {
          const { result, executionTime } = await executeFormulaQuery(
            'IF(AND({fld_number} > 100, {fld_checkbox}), {fld_number} * 2, {fld_number} / 2)'
          );
          console.log(
            `📊 Complex conditional executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 5,
          time: 10000,
        }
      );

      bench(
        'String manipulation: LEFT(UPPER({fld_text}), 10)',
        async () => {
          const { result, executionTime } = await executeFormulaQuery(
            'LEFT(UPPER({fld_text}), 10)'
          );
          console.log(
            `📊 String manipulation executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 5,
          time: 10000,
        }
      );
    });

    // Multi-Formula Query Benchmarks
    describe('Multi-Formula Query Performance', () => {
      bench(
        'Multiple simple formulas in single query',
        async () => {
          const startTime = Date.now();

          // Execute query with multiple formula columns
          const visitor1 = new SelectColumnSqlConversionVisitor(selectQuery, context);
          const visitor2 = new SelectColumnSqlConversionVisitor(selectQuery, context);
          const visitor3 = new SelectColumnSqlConversionVisitor(selectQuery, context);

          const formula1 = parseFormulaToSQL('{fld_number} + 100', visitor1);
          const formula2 = parseFormulaToSQL('{fld_rating} * 2', visitor2);
          const formula3 = parseFormulaToSQL('UPPER({fld_text})', visitor3);

          const query = knexInstance(TABLE_NAME)
            .select('id')
            .select(knexInstance.raw(`(${formula1}) as formula1`))
            .select(knexInstance.raw(`(${formula2}) as formula2`))
            .select(knexInstance.raw(`(${formula3}) as formula3`))
            .limit(QUERY_LIMIT);

          const result = await query;
          const executionTime = Date.now() - startTime;

          console.log(
            `📊 Multi-formula query executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 5,
          time: 15000,
        }
      );
    });

    // Performance Summary
    describe('Performance Summary', () => {
      bench(
        'Baseline query (no formulas)',
        async () => {
          const startTime = Date.now();

          const result = await knexInstance(TABLE_NAME)
            .select('id', 'fld_text', 'fld_number', 'fld_rating')
            .limit(QUERY_LIMIT);

          const executionTime = Date.now() - startTime;
          console.log(
            `📊 Baseline query executed in ${executionTime}ms, returned ${result.length} rows`
          );
        },
        {
          iterations: 20,
          time: 3000,
        }
      );
    });
  }
);
