/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { IFormulaConversionContext, IFieldVo } from '@teable/core';
import {
  FieldType,
  DbFieldType,
  CellValueType,
  isGeneratedFormulaField,
  DriverClient,
} from '@teable/core';
import knex from 'knex';
import type { Knex } from 'knex';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { createGeneratedColumnQuerySupportValidator } from '../src/db-provider/generated-column-query';
import { PostgresProvider } from '../src/db-provider/postgres.provider';
import { SqliteProvider } from '../src/db-provider/sqlite.provider';
import { FieldSelectVisitor } from '../src/features/field/field-select-visitor';
import { createFieldInstanceByVo } from '../src/features/field/model/factory';
import type { FormulaFieldDto } from '../src/features/field/model/field-dto/formula-field.dto';
import { getDriverName } from '../src/utils/db-helpers';

describe('FieldSelectVisitor E2E Tests', () => {
  let knexInstance: Knex;
  let dbProvider: PostgresProvider | SqliteProvider;
  const testTableName = 'test_field_select_visitor';
  const isPostgres = process.env.PRISMA_DATABASE_URL?.includes('postgresql');
  const isSqlite = process.env.PRISMA_DATABASE_URL?.includes('sqlite');

  beforeAll(async () => {
    // Create Knex instance based on database type
    const databaseUrl = process.env.PRISMA_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('Database URL not found in environment');
    }

    if (isPostgres) {
      knexInstance = knex({
        client: 'pg',
        connection: databaseUrl,
      });
      dbProvider = new PostgresProvider(knexInstance);
    } else if (isSqlite) {
      knexInstance = knex({
        client: 'sqlite3',
        connection: {
          filename: databaseUrl.replace('file:', ''),
        },
        useNullAsDefault: true,
      });
      dbProvider = new SqliteProvider(knexInstance);
    } else {
      throw new Error('Unsupported database type');
    }

    // Create test table with various field types
    await knexInstance.schema.dropTableIfExists(testTableName);
    await knexInstance.schema.createTable(testTableName, (table) => {
      table.string('id').primary();
      table.text('text_field');
      table.double('number_field');
      table.boolean('checkbox_field');
      table.timestamp('date_field');
      table.text('formula_field'); // Regular formula field
      table.text('formula_field_generated'); // Generated column for supported formulas
      table.text('formula_field_unsupported'); // Regular field for unsupported formulas
    });
  });

  afterAll(async () => {
    await knexInstance.schema.dropTableIfExists(testTableName);
    await knexInstance.destroy();
  });

  beforeEach(async () => {
    // Clear test data before each test
    await knexInstance(testTableName).del();

    // Insert test data
    await knexInstance(testTableName).insert([
      {
        id: 'row1',
        text_field: 'hello',
        number_field: 10,
        checkbox_field: true,
        date_field: '2024-01-10 08:00:00',
        formula_field: 'hello10',
        formula_field_generated: 'hello10',
        formula_field_unsupported: 'complex_result',
      },
      {
        id: 'row2',
        text_field: 'world',
        number_field: 20,
        checkbox_field: false,
        date_field: '2024-01-12 15:30:00',
        formula_field: 'world20',
        formula_field_generated: 'world20',
        formula_field_unsupported: 'another_complex_result',
      },
    ]);
  });

  // Helper function to create conversion context
  function createContext(): IFormulaConversionContext {
    const fieldMap = new Map();

    // Create field instances for the context
    const textFieldVo: IFieldVo = {
      id: 'fld_text',
      name: 'Text Field',
      type: FieldType.SingleLineText,
      dbFieldType: DbFieldType.Text,
      cellValueType: CellValueType.String,
      dbFieldName: 'text_field',
      options: {},
    };
    fieldMap.set('fld_text', createFieldInstanceByVo(textFieldVo));

    const numberFieldVo: IFieldVo = {
      id: 'fld_number',
      name: 'Number Field',
      type: FieldType.Number,
      dbFieldType: DbFieldType.Real,
      cellValueType: CellValueType.Number,
      dbFieldName: 'number_field',
      options: { formatting: { type: 'number', precision: 2 } },
    };
    fieldMap.set('fld_number', createFieldInstanceByVo(numberFieldVo));

    const checkboxFieldVo: IFieldVo = {
      id: 'fld_checkbox',
      name: 'Checkbox Field',
      type: FieldType.Checkbox,
      dbFieldType: DbFieldType.Boolean,
      cellValueType: CellValueType.Boolean,
      dbFieldName: 'checkbox_field',
      options: {},
    };
    fieldMap.set('fld_checkbox', createFieldInstanceByVo(checkboxFieldVo));

    const dateFieldVo: IFieldVo = {
      id: 'fld_date',
      name: 'Date Field',
      type: FieldType.Date,
      dbFieldType: DbFieldType.DateTime,
      cellValueType: CellValueType.DateTime,
      dbFieldName: 'date_field',
      options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm' } },
    };
    fieldMap.set('fld_date', createFieldInstanceByVo(dateFieldVo));

    return {
      fieldMap,
    };
  }

  describe('Basic Field Types', () => {
    it('should select regular text field correctly', async () => {
      const textFieldVo: IFieldVo = {
        id: 'fld_text',
        name: 'Text Field',
        type: FieldType.SingleLineText,
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        dbFieldName: 'text_field',
        options: {},
      };
      const textField = createFieldInstanceByVo(textFieldVo);

      const qb = knexInstance(testTableName);
      const visitor = new FieldSelectVisitor(knexInstance, qb, dbProvider, createContext());
      const result = textField.accept(visitor);

      // Capture the generated SQL query for basic text field
      const sql = result.toSQL();
      expect(sql.sql).toMatchSnapshot('text-field-query');

      // Execute the query
      const rows = await result;
      expect(rows).toHaveLength(2);
      expect(rows[0].text_field).toBe('hello');
      expect(rows[1].text_field).toBe('world');
    });

    it('should select number field correctly', async () => {
      const numberFieldVo: IFieldVo = {
        id: 'fld_number',
        name: 'Number Field',
        type: FieldType.Number,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        dbFieldName: 'number_field',
        options: { formatting: { type: 'number', precision: 2 } },
      };
      const numberField = createFieldInstanceByVo(numberFieldVo);

      const qb = knexInstance(testTableName);
      const visitor = new FieldSelectVisitor(knexInstance, qb, dbProvider, createContext());
      const result = numberField.accept(visitor);

      const rows = await result;
      expect(rows).toHaveLength(2);
      expect(rows[0].number_field).toBe(10);
      expect(rows[1].number_field).toBe(20);
    });

    it('should select checkbox field correctly', async () => {
      const checkboxFieldVo: IFieldVo = {
        id: 'fld_checkbox',
        name: 'Checkbox Field',
        type: FieldType.Checkbox,
        dbFieldType: DbFieldType.Boolean,
        cellValueType: CellValueType.Boolean,
        dbFieldName: 'checkbox_field',
        options: {},
      };
      const checkboxField = createFieldInstanceByVo(checkboxFieldVo);

      const qb = knexInstance(testTableName);
      const visitor = new FieldSelectVisitor(knexInstance, qb, dbProvider, createContext());
      const result = checkboxField.accept(visitor);

      const rows = await result;
      expect(rows).toHaveLength(2);
      expect(rows[0].checkbox_field).toBe(true);
      expect(rows[1].checkbox_field).toBe(false);
    });

    it('should select date field correctly', async () => {
      const dateFieldVo: IFieldVo = {
        id: 'fld_date',
        name: 'Date Field',
        type: FieldType.Date,
        dbFieldType: DbFieldType.DateTime,
        cellValueType: CellValueType.DateTime,
        dbFieldName: 'date_field',
        options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm' } },
      };
      const dateField = createFieldInstanceByVo(dateFieldVo);

      const qb = knexInstance(testTableName);
      const visitor = new FieldSelectVisitor(knexInstance, qb, dbProvider, createContext());
      const result = dateField.accept(visitor);

      const rows = await result;
      expect(rows).toHaveLength(2);
      expect(rows[0].date_field).toBeDefined();
      expect(rows[1].date_field).toBeDefined();
    });
  });

  describe('Formula Fields', () => {
    it('should select regular formula field (dbGenerated=false)', async () => {
      const formulaFieldVo: IFieldVo = {
        id: 'fld_formula',
        name: 'Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        dbFieldName: 'formula_field',
        options: {
          expression: '{fld_text} & {fld_number}',
          dbGenerated: false,
        },
      };
      const formulaField = createFieldInstanceByVo(formulaFieldVo);

      // Verify that this is NOT a generated formula field
      expect(isGeneratedFormulaField(formulaField)).toBe(false);

      const qb = knexInstance(testTableName);
      const visitor = new FieldSelectVisitor(knexInstance, qb, dbProvider, createContext());
      const result = formulaField.accept(visitor);

      // Capture the generated SQL query
      const sql = result.toSQL();
      expect(sql.sql).toMatchSnapshot('regular-formula-field-query');

      const rows = await result;
      expect(rows).toHaveLength(2);
      expect(rows[0].formula_field).toBe('hello10');
      expect(rows[1].formula_field).toBe('world20');
    });

    it('should select generated column for supported formula (dbGenerated=true)', async () => {
      // First, let's create a table with an actual generated column for this test
      const generatedTableName = 'test_generated_column';
      await knexInstance.schema.dropTableIfExists(generatedTableName);

      // Create table with generated column (PostgreSQL syntax)
      if (isPostgres) {
        await knexInstance.schema.raw(`
          CREATE TABLE ${generatedTableName} (
            id TEXT PRIMARY KEY,
            text_field TEXT,
            number_field DOUBLE PRECISION,
            formula_field___generated TEXT GENERATED ALWAYS AS (text_field || number_field::text) STORED
          )
        `);
      } else {
        // For SQLite, create a regular table since generated columns might not be supported
        await knexInstance.schema.createTable(generatedTableName, (table) => {
          table.string('id').primary();
          table.text('text_field');
          table.double('number_field');
          table.text('formula_field___generated');
        });
      }

      // Insert test data
      await knexInstance(generatedTableName).insert([
        {
          id: 'row1',
          text_field: 'hello',
          number_field: 10,
          ...(isSqlite && { formula_field___generated: 'hello10' }),
        },
        {
          id: 'row2',
          text_field: 'world',
          number_field: 20,
          ...(isSqlite && { formula_field___generated: 'world20' }),
        },
      ]);

      const formulaFieldVo: IFieldVo = {
        id: 'fld_formula_generated',
        name: 'Generated Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        dbFieldName: 'formula_field',
        options: {
          expression: '{fld_text} & {fld_number}', // Simple concatenation - should be supported
          dbGenerated: true,
        },
      };
      const formulaField = createFieldInstanceByVo(formulaFieldVo);

      // Check if this is a generated formula field
      expect(isGeneratedFormulaField(formulaField)).toBe(true);

      // Check if the formula is supported for generated columns
      const driverName = getDriverName(knexInstance) as string;
      // Map knex client names to DriverClient enum values
      const driverClient =
        driverName === 'pg'
          ? DriverClient.Pg
          : driverName === 'sqlite3'
            ? DriverClient.Sqlite
            : (driverName as DriverClient);
      const supportValidator = createGeneratedColumnQuerySupportValidator(driverClient);
      const isSupported = (formulaField as FormulaFieldDto).validateGeneratedColumnSupport(
        supportValidator
      );

      const qb = knexInstance(generatedTableName);
      const visitor = new FieldSelectVisitor(knexInstance, qb, dbProvider, createContext());
      const result = formulaField.accept(visitor);

      // Capture the generated SQL query
      const sql = result.toSQL();
      if (isSupported && isPostgres) {
        // Should select from generated column directly
        expect(sql.sql).toMatchSnapshot('generated-column-supported-query');
      } else {
        // Should fall back to computed SQL
        expect(sql.sql).toMatchSnapshot('generated-column-fallback-query');
      }

      const rows = await result;
      expect(rows).toHaveLength(2);

      if (isSupported && isPostgres) {
        // Should select from generated column
        expect(rows[0].formula_field___generated).toBe('hello10');
        expect(rows[1].formula_field___generated).toBe('world20');
      } else {
        // Should fall back to computed SQL or use regular column
        expect(rows[0]).toBeDefined();
        expect(rows[1]).toBeDefined();
      }

      // Clean up
      await knexInstance.schema.dropTableIfExists(generatedTableName);
    });

    it('should use computed SQL for unsupported formula (dbGenerated=true but not supported)', async () => {
      const formulaFieldVo: IFieldVo = {
        id: 'fld_formula_unsupported',
        name: 'Unsupported Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        dbFieldName: 'formula_field_unsupported',
        options: {
          expression: 'ARRAY_JOIN({fld_text}, ",")', // ARRAY_JOIN function is not supported for generated columns
          dbGenerated: true,
        },
      };
      const formulaField = createFieldInstanceByVo(formulaFieldVo);

      // Check if this is a generated formula field
      expect(isGeneratedFormulaField(formulaField)).toBe(true);

      // Check if the formula is supported for generated columns
      const driverName = getDriverName(knexInstance);
      const supportValidator = createGeneratedColumnQuerySupportValidator(driverName);
      const isSupported = (formulaField as FormulaFieldDto).validateGeneratedColumnSupport(
        supportValidator
      );

      // ARRAY_JOIN function should not be supported
      expect(isSupported).toBe(false);

      const qb = knexInstance(testTableName);
      const visitor = new FieldSelectVisitor(knexInstance, qb, dbProvider, createContext());

      // This should use computed SQL instead of generated column
      const result = formulaField.accept(visitor);

      // Capture the generated SQL query - should use computed SQL since ARRAY_JOIN is not supported
      const sql = result.toSQL();
      expect(sql.sql).toMatchSnapshot('unsupported-formula-computed-sql-query');

      // The query should be constructed
      expect(result).toBeDefined();
    });
  });

  describe('Generated Column Support Detection', () => {
    it('should correctly detect supported vs unsupported formulas', () => {
      const supportedFormulaVo: IFieldVo = {
        id: 'fld_supported',
        name: 'Supported Formula',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        dbFieldName: 'supported_field',
        options: {
          expression: '{fld_text} & {fld_number}', // Simple concatenation
          dbGenerated: true,
        },
      };
      const supportedFormula = createFieldInstanceByVo(supportedFormulaVo);

      const unsupportedFormulaVo: IFieldVo = {
        id: 'fld_unsupported',
        name: 'Unsupported Formula',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        dbFieldName: 'unsupported_field',
        options: {
          expression: 'ARRAY_JOIN({fld_text}, ",")', // ARRAY_JOIN function
          dbGenerated: true,
        },
      };
      const unsupportedFormula = createFieldInstanceByVo(unsupportedFormulaVo);

      const driverName = getDriverName(knexInstance);
      const supportValidator = createGeneratedColumnQuerySupportValidator(driverName);

      const supportedResult = (supportedFormula as FormulaFieldDto).validateGeneratedColumnSupport(
        supportValidator
      );
      const unsupportedResult = (
        unsupportedFormula as FormulaFieldDto
      ).validateGeneratedColumnSupport(supportValidator);

      // Simple concatenation should be supported
      expect(supportedResult).toBe(true);

      // ARRAY_JOIN function should not be supported
      expect(unsupportedResult).toBe(false);
    });
  });
});
