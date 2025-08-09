/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { IFormulaConversionContext } from '@teable/core';
import { FieldType, DbFieldType, CellValueType } from '@teable/core';
import { plainToInstance } from 'class-transformer';
import type { Knex } from 'knex';
import knex from 'knex';
import { newDb } from 'pg-mem';
import { describe, bench } from 'vitest';
import { PostgresProvider } from '../src/db-provider/postgres.provider';
import { createFieldInstanceByVo } from '../src/features/field/model/factory';
import { FormulaFieldDto } from '../src/features/field/model/field-dto/formula-field.dto';

// Test configuration
const RECORD_COUNT = 50000;
const PG_TABLE_NAME = 'perf_test_table_pg_mem';

// Helper function to create test data ONCE
async function setupDatabase(
  tableName: string,
  recordCount: number,
  knexInstance: Knex
): Promise<void> {
  console.log(`🚀 Setting up PostgreSQL (pg-mem) bench test...`);

  try {
    // Clean up existing table
    const tableExists = await knexInstance.schema.hasTable(tableName);
    if (tableExists) {
      await knexInstance.schema.dropTable(tableName);
      console.log(`🧹 Cleaned up existing table ${tableName}`);
    }

    // Create table with proper schema
    await knexInstance.schema.createTable(tableName, (table) => {
      table.text('id').primary();
      table.text('fld_text');
      table.double('fld_number');
      table.timestamp('fld_date');
      table.boolean('fld_checkbox');
    });

    console.log(`📋 Created table ${tableName}`);
    console.log(`Creating ${recordCount} records for PostgreSQL (pg-mem) performance test...`);

    // Insert test data in batches
    const batchSize = 1000;
    const totalBatches = Math.ceil(recordCount / batchSize);

    for (let batch = 0; batch < totalBatches; batch++) {
      const batchData = [];
      const startIdx = batch * batchSize;
      const endIdx = Math.min(startIdx + batchSize, recordCount);

      for (let i = startIdx; i < endIdx; i++) {
        batchData.push({
          id: `rec_${i.toString().padStart(8, '0')}`,
          fld_text: `Sample text ${i}`,
          fld_number: Math.floor(Math.random() * 1000) + 1,
          fld_date: new Date(2024, 0, 1 + (i % 365)),
          fld_checkbox: i % 2 === 0,
        });
      }

      await knexInstance(tableName).insert(batchData);

      // Log progress every 20 batches
      if ((batch + 1) % 20 === 0 || batch === totalBatches - 1) {
        console.log(
          `Inserted batch ${batch + 1}/${totalBatches} (${endIdx}/${recordCount} records)`
        );
      }
    }

    // Verify record count
    const actualCount = await knexInstance(tableName).count('* as count').first();
    const count = actualCount?.count;
    if (Number(count) !== recordCount) {
      throw new Error(`Expected ${recordCount} records, but found ${count} in table ${tableName}`);
    }

    console.log(`✅ Successfully created ${recordCount} records for PostgreSQL (pg-mem) test`);
  } catch (error) {
    console.error(`❌ Failed to setup database for ${tableName}:`, error);
    throw error;
  }
}

// Helper function to create formula field
function createFormulaField(expression: string): FormulaFieldDto {
  const fieldId = `test_field_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  return plainToInstance(FormulaFieldDto, {
    id: fieldId,
    name: 'test_formula',
    type: FieldType.Formula,
    options: {
      expression,
    },
    cellValueType: CellValueType.Number,
    dbFieldType: DbFieldType.Real,
    dbFieldName: `fld_${fieldId}`,
  });
}

// Helper function to create context
function createContext(): IFormulaConversionContext {
  const fieldMap = new Map();
  const numberField = createFieldInstanceByVo({
    id: 'fld_number',
    name: 'fld_number',
    type: FieldType.Number,
    dbFieldName: 'fld_number',
    dbFieldType: DbFieldType.Real,
    cellValueType: CellValueType.Number,
    options: { formatting: { type: 'decimal', precision: 2 } },
  });
  fieldMap.set('fld_number', numberField);
  return {
    fieldMap,
  };
}

// Helper function to get PostgreSQL (pg-mem) connection
async function getPgMemKnex(): Promise<Knex> {
  // Create a new in-memory PostgreSQL database
  const db = newDb();

  // Use the official pg-mem knex adapter
  const knexInstance = await db.adapters.createKnex();

  return knexInstance as Knex;
}

// Global setup state
let isSetupComplete = false;
let globalPgMemKnex: Knex;
const tableName = PG_TABLE_NAME + '_bench';

// Ensure setup runs only once
async function ensureSetup() {
  if (!isSetupComplete) {
    globalPgMemKnex = await getPgMemKnex();
    await setupDatabase(tableName, RECORD_COUNT, globalPgMemKnex);
    console.log(`🚀 PostgreSQL (pg-mem) setup complete: ${tableName} with ${RECORD_COUNT} records`);
    isSetupComplete = true;
  }
  return globalPgMemKnex;
}

describe('Generated Column Performance Benchmarks (pg-mem)', () => {
  describe('PostgreSQL (pg-mem) Generated Column Performance', () => {
    bench(
      'Create generated column with simple addition formula',
      async () => {
        const pgMemKnex = await ensureSetup();
        const provider = new PostgresProvider(pgMemKnex);
        const formulaField = createFormulaField('{fld_number} + 1');
        const context = createContext();

        // Generate and execute SQL for creating the formula column
        const sql = provider.createColumnSchema(
          tableName,
          formulaField,
          context.fieldMap,
          false, // isNewTable
          'test-table-id', // tableId
          new Map() // tableNameMap
        );

        // This is what we're actually benchmarking - the ALTER TABLE command
        await pgMemKnex.raw(sql);

        // Clean up: pg-mem can handle more columns, but we still clean up for consistency
        const columnName = formulaField.getGeneratedColumnName();
        const mainColumnName = formulaField.dbFieldName;

        await pgMemKnex.schema.alterTable(tableName, (t) =>
          t.dropColumns(columnName, mainColumnName)
        );
      },
      {
        iterations: 50,
        time: 10000,
      }
    );

    bench(
      'Create generated column with multiplication formula',
      async () => {
        const pgMemKnex = await ensureSetup();
        const provider = new PostgresProvider(pgMemKnex);
        const formulaField = createFormulaField('{fld_number} * 2');
        const context = createContext();

        // Generate and execute SQL for creating the formula column
        const sql = provider.createColumnSchema(
          tableName,
          formulaField,
          context.fieldMap,
          false, // isNewTable
          'test-table-id', // tableId
          new Map() // tableNameMap
        );

        // This is what we're actually benchmarking - the ALTER TABLE command
        await pgMemKnex.raw(sql);

        // Clean up: pg-mem can handle more columns, but we still clean up for consistency
        const columnName = formulaField.getGeneratedColumnName();
        const mainColumnName = formulaField.dbFieldName;

        await pgMemKnex.schema.alterTable(tableName, (t) =>
          t.dropColumns(columnName, mainColumnName)
        );
      },
      {
        iterations: 50,
        time: 10000,
      }
    );

    bench(
      'Create generated column with complex formula',
      async () => {
        const pgMemKnex = await ensureSetup();
        const provider = new PostgresProvider(pgMemKnex);
        const formulaField = createFormulaField('({fld_number} + 10) * 2');
        const context = createContext();

        // Generate and execute SQL for creating the formula column
        const sql = provider.createColumnSchema(
          tableName,
          formulaField,
          context.fieldMap,
          false, // isNewTable
          'test-table-id', // tableId
          new Map() // tableNameMap
        );

        // This is what we're actually benchmarking - the ALTER TABLE command
        await pgMemKnex.raw(sql);

        // Clean up: pg-mem can handle more columns, but we still clean up for consistency
        const columnName = formulaField.getGeneratedColumnName();
        const mainColumnName = formulaField.dbFieldName;

        await pgMemKnex.schema.alterTable(tableName, (t) =>
          t.dropColumns(columnName, mainColumnName)
        );
      },
      {
        iterations: 50,
        time: 10000,
      }
    );

    bench(
      'Create generated column with very complex nested formula',
      async () => {
        const pgMemKnex = await ensureSetup();
        const provider = new PostgresProvider(pgMemKnex);
        const formulaField = createFormulaField(
          'IF({fld_number} > 500, ({fld_number} * 2) + 100, ({fld_number} / 2) - 50)'
        );
        const context = createContext();

        // Generate and execute SQL for creating the formula column
        const sql = provider.createColumnSchema(
          tableName,
          formulaField,
          context.fieldMap,
          false, // isNewTable
          'test-table-id', // tableId
          new Map() // tableNameMap
        );

        // This is what we're actually benchmarking - the ALTER TABLE command
        await pgMemKnex.raw(sql);

        // Clean up: pg-mem can handle more columns, but we still clean up for consistency
        const columnName = formulaField.getGeneratedColumnName();
        const mainColumnName = formulaField.dbFieldName;

        await pgMemKnex.schema.alterTable(tableName, (t) =>
          t.dropColumns(columnName, mainColumnName)
        );
      },
      {
        iterations: 50,
        time: 10000,
      }
    );
  });
});
