import {
  FormulaFieldCore,
  FieldType,
  CellValueType,
  DbFieldType,
  getGeneratedColumnName,
} from '@teable/core';
import { plainToInstance } from 'class-transformer';
import type { Knex } from 'knex';
import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IDbProvider } from '../../db-provider/db.provider.interface';
import {
  PostgresDatabaseColumnVisitor,
  type IDatabaseColumnContext,
} from './database-column-visitor.postgres';
import { SqliteDatabaseColumnVisitor } from './database-column-visitor.sqlite';

describe('Database Column Visitor', () => {
  let mockKnex: Knex;
  let mockTable: Knex.CreateTableBuilder;
  let context: IDatabaseColumnContext;
  let mockTextFn: Mock;
  let mockDoubleFn: Mock;
  let mockIntegerFn: Mock;
  let mockBooleanFn: Mock;
  let mockDatetimeFn: Mock;
  let mockJsonbFn: Mock;
  let mockBinaryFn: Mock;
  let mockSpecificTypeFn: Mock;
  let mockDbProvider: IDbProvider;
  let mockSqliteDbProvider: IDbProvider;

  beforeEach(() => {
    mockTextFn = vi.fn().mockReturnThis();
    mockDoubleFn = vi.fn().mockReturnThis();
    mockIntegerFn = vi.fn().mockReturnThis();
    mockBooleanFn = vi.fn().mockReturnThis();
    mockDatetimeFn = vi.fn().mockReturnThis();
    mockJsonbFn = vi.fn().mockReturnThis();
    mockBinaryFn = vi.fn().mockReturnThis();
    mockSpecificTypeFn = vi.fn().mockReturnThis();

    mockTable = {
      text: mockTextFn,
      double: mockDoubleFn,
      integer: mockIntegerFn,
      boolean: mockBooleanFn,
      datetime: mockDatetimeFn,
      jsonb: mockJsonbFn,
      binary: mockBinaryFn,
      specificType: mockSpecificTypeFn,
    } as any;

    mockDbProvider = {
      convertFormula: vi.fn().mockReturnValue({
        sql: 'COALESCE("field1", 0) + COALESCE("field2", 0)', // PostgreSQL uses double quotes
        dependencies: ['fld1', 'fld2'],
      }),
    } as any;

    mockSqliteDbProvider = {
      convertFormula: vi.fn().mockReturnValue({
        sql: 'COALESCE(`field1`, 0) + COALESCE(`field2`, 0)', // SQLite uses backticks
        dependencies: ['fld1', 'fld2'],
      }),
    } as any;

    mockKnex = {
      client: {
        config: {
          client: 'pg',
        },
      },
    } as any;

    context = {
      table: mockTable,
      fieldId: 'fld123',
      dbFieldName: 'test_field',
      unique: false,
      notNull: false,
      dbProvider: mockDbProvider,
      fieldMap: {
        fld1: { columnName: 'field1' },
        fld2: { columnName: 'field2' },
      },
      isNewTable: false,
    };
  });

  describe('PostgresDatabaseColumnVisitor', () => {
    it('should create standard column for formula field without dbGenerated', () => {
      const formulaField = plainToInstance(FormulaFieldCore, {
        id: 'fld123',
        name: 'Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        dbFieldName: 'test_field',
        options: {
          expression: '1 + 1',
          dbGenerated: false,
        },
      });

      const visitor = new PostgresDatabaseColumnVisitor(context);
      formulaField.accept(visitor);

      expect(mockDoubleFn).toHaveBeenCalledWith('test_field');
      expect(mockDoubleFn).toHaveBeenCalledTimes(1);
    });

    it('should create both standard and generated columns for formula field with dbGenerated=true', () => {
      const formulaField = plainToInstance(FormulaFieldCore, {
        id: 'fld123',
        name: 'Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        dbFieldName: 'test_field',
        options: {
          expression: '1 + 1',
          dbGenerated: true,
        },
      });

      const visitor = new PostgresDatabaseColumnVisitor(context);
      formulaField.accept(visitor);

      expect(mockDoubleFn).toHaveBeenCalledWith('test_field');
      expect(mockSpecificTypeFn).toHaveBeenCalledWith(
        getGeneratedColumnName('test_field'),
        'DOUBLE PRECISION GENERATED ALWAYS AS (COALESCE("field1", 0) + COALESCE("field2", 0)) STORED'
      );
      expect(mockDoubleFn).toHaveBeenCalledTimes(1);
      expect(mockSpecificTypeFn).toHaveBeenCalledTimes(1);
    });

    it('should handle formula conversion errors gracefully', () => {
      const formulaField = plainToInstance(FormulaFieldCore, {
        id: 'fld123',
        name: 'Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: {
          expression: 'INVALID_EXPRESSION',
          dbGenerated: true,
        },
      });

      // Mock formula conversion to throw an error
      const errorContext = {
        ...context,
        dbProvider: {
          convertFormula: vi.fn().mockImplementation(() => {
            throw new Error('Invalid formula expression');
          }),
        } as any,
      };

      const visitor = new PostgresDatabaseColumnVisitor(errorContext);
      formulaField.accept(visitor);

      // Should create standard column but not generated column
      expect(mockDoubleFn).toHaveBeenCalledWith('test_field');
      expect(mockSpecificTypeFn).not.toHaveBeenCalled();
      expect(mockDoubleFn).toHaveBeenCalledTimes(1);
    });

    it('should use expanded expression when available', () => {
      const formulaField = plainToInstance(FormulaFieldCore, {
        id: 'fld123',
        name: 'Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Real,
        dbFieldName: 'test_field',
        cellValueType: CellValueType.Number,
        options: {
          expression: '{fld456} * 2', // Original expression
          dbGenerated: true,
        },
      });

      const mockDbProvider = {
        convertFormula: vi.fn().mockReturnValue({
          sql: '("field1" + 10) * 2',
          dependencies: ['field1'],
        }),
      };

      const fieldMapWithExpansion = {
        fld123: {
          columnName: 'test_field',
          fieldType: 'formula',
          dbGenerated: true,
          expandedExpression: '({fld456} + 10) * 2', // Expanded expression
        },
        fld456: {
          columnName: 'field1',
          fieldType: 'formula',
          dbGenerated: true,
        },
        field1: {
          columnName: 'field1',
          fieldType: 'number',
          dbGenerated: false,
        },
      };

      const expansionContext: IDatabaseColumnContext = {
        table: mockTable,
        fieldId: 'fld123',
        dbFieldName: 'test_field',
        dbProvider: mockDbProvider as any,
        fieldMap: fieldMapWithExpansion,
      };

      const visitor = new PostgresDatabaseColumnVisitor(expansionContext);
      formulaField.accept(visitor);

      // Should call convertFormula with expanded expression, not original
      expect(mockDbProvider.convertFormula).toHaveBeenCalledWith(
        '({fld456} + 10) * 2', // Expanded expression
        expect.objectContaining({
          fieldMap: fieldMapWithExpansion,
        })
      );

      expect(mockSpecificTypeFn).toHaveBeenCalledWith(
        getGeneratedColumnName('test_field'),
        'DOUBLE PRECISION GENERATED ALWAYS AS (("field1" + 10) * 2) STORED'
      );
    });
  });

  describe('SqliteDatabaseColumnVisitor', () => {
    let sqliteContext: IDatabaseColumnContext;

    beforeEach(() => {
      mockKnex.client.config.client = 'sqlite3';
      sqliteContext = {
        ...context,
        dbProvider: mockSqliteDbProvider,
      };
    });

    it('should create standard column for formula field without dbGenerated', () => {
      const formulaField = plainToInstance(FormulaFieldCore, {
        id: 'fld123',
        name: 'Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        dbFieldName: 'test_field',
        options: {
          expression: '1 + 1',
          dbGenerated: false,
        },
      });

      const visitor = new SqliteDatabaseColumnVisitor(sqliteContext);
      formulaField.accept(visitor);

      expect(mockDoubleFn).toHaveBeenCalledWith('test_field');
      expect(mockDoubleFn).toHaveBeenCalledTimes(1);
    });

    it('should create both standard and generated columns for formula field with dbGenerated=true', () => {
      const formulaField = plainToInstance(FormulaFieldCore, {
        id: 'fld123',
        name: 'Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        dbFieldName: 'test_field',
        options: {
          expression: '1 + 1',
          dbGenerated: true,
        },
      });

      const visitor = new SqliteDatabaseColumnVisitor(sqliteContext);
      formulaField.accept(visitor);

      expect(mockDoubleFn).toHaveBeenCalledWith('test_field');
      expect(mockSpecificTypeFn).toHaveBeenCalledWith(
        getGeneratedColumnName('test_field'),
        'REAL GENERATED ALWAYS AS (COALESCE(`field1`, 0) + COALESCE(`field2`, 0)) VIRTUAL'
      );
      expect(mockDoubleFn).toHaveBeenCalledTimes(1);
      expect(mockSpecificTypeFn).toHaveBeenCalledTimes(1);
    });

    it('should use STORED for new table creation in SQLite', () => {
      const formulaField = plainToInstance(FormulaFieldCore, {
        id: 'fld123',
        name: 'Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        dbFieldName: 'test_field',
        options: {
          expression: '1 + 1',
          dbGenerated: true,
        },
      });

      const newTableContext = {
        ...sqliteContext,
        isNewTable: true,
      };

      const visitor = new SqliteDatabaseColumnVisitor(newTableContext);
      formulaField.accept(visitor);

      expect(mockDoubleFn).toHaveBeenCalledWith('test_field');
      expect(mockSpecificTypeFn).toHaveBeenCalledWith(
        getGeneratedColumnName('test_field'),
        'REAL GENERATED ALWAYS AS (COALESCE(`field1`, 0) + COALESCE(`field2`, 0)) STORED'
      );
      expect(mockDoubleFn).toHaveBeenCalledTimes(1);
      expect(mockSpecificTypeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Generated column naming', () => {
    it('should use consistent naming convention for generated columns', () => {
      const formulaField = plainToInstance(FormulaFieldCore, {
        id: 'fld123',
        name: 'Formula Field',
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        dbFieldName: 'very_long_field_name_that_might_cause_issues',
        options: {
          expression: 'CONCATENATE("Hello", " World")',
          dbGenerated: true,
        },
      });

      const contextWithLongName = {
        ...context,
        dbFieldName: 'very_long_field_name_that_might_cause_issues',
      };

      const visitor = new PostgresDatabaseColumnVisitor(contextWithLongName);
      formulaField.accept(visitor);

      expect(mockTextFn).toHaveBeenCalledWith('very_long_field_name_that_might_cause_issues');
      expect(mockSpecificTypeFn).toHaveBeenCalledWith(
        'very_long_field_name_that_might_cause_issues___generated',
        'TEXT GENERATED ALWAYS AS (COALESCE("field1", 0) + COALESCE("field2", 0)) STORED'
      );
      expect(mockTextFn).toHaveBeenCalledTimes(1);
      expect(mockSpecificTypeFn).toHaveBeenCalledTimes(1);
    });
  });
});
