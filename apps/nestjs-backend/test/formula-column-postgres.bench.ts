/* eslint-disable @typescript-eslint/naming-convention */
import { FieldType, DbFieldType, CellValueType } from '@teable/core';
import type { IFormulaConversionContext } from '@teable/core';
import { plainToInstance } from 'class-transformer';
import type { Knex } from 'knex';
import knex from 'knex';
import { describe, bench } from 'vitest';
import { PostgresProvider } from '../src/db-provider/postgres.provider';
import { FormulaFieldDto } from '../src/features/field/model/field-dto/formula-field.dto';

// Test configuration
const RECORD_COUNT = 50000;
const PG_TABLE_NAME = 'perf_test_table_pg';

// Helper function to create test data ONCE
async function setupDatabase(
  tableName: string,
  recordCount: number,
  knexInstance: Knex
): Promise<void> {
  console.log(`🚀 Setting up PostgreSQL bench test...`);

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
    console.log(`Creating ${recordCount} records for PostgreSQL performance test...`);

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

    console.log(`✅ Successfully created ${recordCount} records for PostgreSQL test`);
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
      dbGenerated: true,
      expression,
    },
    cellValueType: CellValueType.Number,
    dbFieldType: DbFieldType.Real,
    dbFieldName: `fld_${fieldId}`,
  });
}

// Helper function to create context
function createContext(): IFormulaConversionContext {
  return {
    fieldMap: {
      fld_number: {
        columnName: 'fld_number',
        fieldType: 'Number',
      },
    },
  };
}

// Helper function to get PostgreSQL connection
function getPgKnex(): Knex {
  return knex({
    client: 'pg',
    connection: process.env.PRISMA_DATABASE_URL,
  });
}

// Global setup state
let isSetupComplete = false;
let globalPgKnex: Knex;
const tableName = PG_TABLE_NAME + '_bench';

// Ensure setup runs only once
async function ensureSetup() {
  if (!isSetupComplete) {
    globalPgKnex = getPgKnex();
    await setupDatabase(tableName, RECORD_COUNT, globalPgKnex);
    console.log(`🚀 PostgreSQL setup complete: ${tableName} with ${RECORD_COUNT} records`);
    isSetupComplete = true;
  }
  return globalPgKnex;
}

describe('Generated Column Performance Benchmarks', () => {
  describe('PostgreSQL Generated Column Performance', () => {
    bench(
      'Create generated column with simple addition formula',
      async () => {
        const pgKnex = await ensureSetup();
        const provider = new PostgresProvider(pgKnex);
        const formulaField = createFormulaField('{fld_number} + 1');
        const context = createContext();
        const columnName = formulaField.getGeneratedColumnName();
        const mainColumnName = formulaField.dbFieldName;

        // Generate and execute SQL for creating the formula column
        const sql = provider.createColumnSchema(tableName, formulaField, context.fieldMap);

        // This is what we're actually benchmarking - the ALTER TABLE command
        await pgKnex.raw(sql);

        await pgKnex.schema.alterTable(tableName, (t) => t.dropColumns(columnName, mainColumnName));
      },
      {
        iterations: 5,
        time: 30000,
      }
    );

    bench(
      'Create generated column with multiplication formula',
      async () => {
        const pgKnex = await ensureSetup();
        const provider = new PostgresProvider(pgKnex);
        const formulaField = createFormulaField('{fld_number} * 2');
        const context = createContext();
        const columnName = formulaField.getGeneratedColumnName();
        const mainColumnName = formulaField.dbFieldName;

        // Generate and execute SQL for creating the formula column
        const sql = provider.createColumnSchema(tableName, formulaField, context.fieldMap);

        // This is what we're actually benchmarking - the ALTER TABLE command
        await pgKnex.raw(sql);

        await pgKnex.schema.alterTable(tableName, (t) => t.dropColumns(columnName, mainColumnName));
      },
      {
        iterations: 5,
        time: 30000,
      }
    );

    bench(
      'Create generated column with complex formula',
      async () => {
        const pgKnex = await ensureSetup();
        const provider = new PostgresProvider(pgKnex);
        const formulaField = createFormulaField('({fld_number} + 10) * 2');
        const context = createContext();
        const columnName = formulaField.getGeneratedColumnName();
        const mainColumnName = formulaField.dbFieldName;

        // Generate and execute SQL for creating the formula column
        const sql = provider.createColumnSchema(tableName, formulaField, context.fieldMap);

        // This is what we're actually benchmarking - the ALTER TABLE command
        await pgKnex.raw(sql);

        await pgKnex.schema.alterTable(tableName, (t) => t.dropColumns(columnName, mainColumnName));
      },
      {
        iterations: 5,
        time: 30000,
      }
    );

    bench(
      'Create generated column with very complex nested formula',
      async () => {
        const pgKnex = await ensureSetup();
        const provider = new PostgresProvider(pgKnex);
        const formulaField = createFormulaField(
          'IF({fld_number} > 500, ({fld_number} * 2) + 100, ({fld_number} / 2) - 50)'
        );
        const context = createContext();
        const columnName = formulaField.getGeneratedColumnName();
        const mainColumnName = formulaField.dbFieldName;

        // Generate and execute SQL for creating the formula column
        const sql = provider.createColumnSchema(tableName, formulaField, context.fieldMap);

        // This is what we're actually benchmarking - the ALTER TABLE command
        await pgKnex.raw(sql);

        await pgKnex.schema.alterTable(tableName, (t) => t.dropColumns(columnName, mainColumnName));
      },
      {
        iterations: 5,
        time: 30000,
      }
    );
  });
});
