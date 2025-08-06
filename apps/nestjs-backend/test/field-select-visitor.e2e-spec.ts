/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { IFormulaConversionContext, IFieldVo } from '@teable/core';
import { FieldType, DbFieldType, CellValueType } from '@teable/core';
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
      const visitor = new FieldSelectVisitor(qb, dbProvider, createContext());
      const selector = textField.accept(visitor);

      // FieldSelectVisitor should return the field selector, not a full query
      expect(selector).toBe('text_field');

      // Test that the selector works in a real query
      const query = qb.select(selector);
      const rows = await query;
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
      const visitor = new FieldSelectVisitor(qb, dbProvider, createContext());
      const selector = numberField.accept(visitor);

      // FieldSelectVisitor should return the field selector
      expect(selector).toBe('number_field');

      // Test that the selector works in a real query
      const query = qb.select(selector);
      const rows = await query;
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
      const visitor = new FieldSelectVisitor(qb, dbProvider, createContext());
      const selector = checkboxField.accept(visitor);

      // FieldSelectVisitor should return the field selector
      expect(selector).toBe('checkbox_field');

      // Test that the selector works in a real query
      const query = qb.select(selector);
      const rows = await query;
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
      const visitor = new FieldSelectVisitor(qb, dbProvider, createContext());
      const selector = dateField.accept(visitor);

      // FieldSelectVisitor should return the field selector
      expect(selector).toBe('date_field');

      // Test that the selector works in a real query
      const query = qb.select(selector);
      const rows = await query;
      expect(rows).toHaveLength(2);
      expect(rows[0].date_field).toBeDefined();
      expect(rows[1].date_field).toBeDefined();
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
