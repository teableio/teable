import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType, getGeneratedColumnName } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { DB_PROVIDER_SYMBOL } from '../../db-provider/db.provider';
import type { IFormulaConversionContext } from '../../db-provider/formula-query/formula-query.interface';
import { BatchService } from '../calculation/batch.service';
import { FormulaFieldService } from './field-calculate/formula-field.service';
import { FieldService } from './field.service';
import { FormulaExpansionService } from './formula-expansion.service';

describe('Formula Generated Column References', () => {
  let formulaFieldService: FormulaFieldService;

  const mockFieldFindMany = vi.fn();
  const mockPrismaService = {
    txClient: vi.fn(() => ({
      field: {
        findMany: mockFieldFindMany,
      },
    })),
  };

  const mockDbProvider = {
    convertFormula: vi.fn(),
  };

  const mockBatchService = {};
  const mockClsService = {};
  const mockKnex = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FieldService,
        FormulaFieldService,
        FormulaExpansionService,
        {
          provide: BatchService,
          useValue: mockBatchService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ClsService,
          useValue: mockClsService,
        },
        {
          provide: DB_PROVIDER_SYMBOL,
          useValue: mockDbProvider,
        },
        {
          provide: 'CUSTOM_KNEX',
          useValue: mockKnex,
        },
      ],
    }).compile();

    formulaFieldService = module.get<FormulaFieldService>(FormulaFieldService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('buildFieldMapForTable', () => {
    it('should use generated column name for formula fields with dbGenerated=true', async () => {
      // Mock database fields
      const mockFields = [
        {
          id: 'fld1',
          dbFieldName: 'field1',
          type: FieldType.SingleLineText,
          options: null,
        },
        {
          id: 'fld2',
          dbFieldName: 'field2',
          type: FieldType.Formula,
          options: JSON.stringify({ expression: '{fld1} + " suffix"', dbGenerated: true }),
        },
        {
          id: 'fld3',
          dbFieldName: 'field3',
          type: FieldType.Formula,
          options: JSON.stringify({ expression: '{fld1} + " other"', dbGenerated: false }),
        },
      ];

      mockFieldFindMany.mockResolvedValue(mockFields);

      // Call the public method directly
      const fieldMap = await formulaFieldService.buildFieldMapForTable('tbl123');

      expect(fieldMap).toEqual({
        fld1: {
          columnName: 'field1',
          fieldType: FieldType.SingleLineText,
          dbGenerated: false,
        },
        fld2: {
          columnName: getGeneratedColumnName('field2'), // Should use generated column name
          fieldType: FieldType.Formula,
          dbGenerated: true,
        },
        fld3: {
          columnName: 'field3', // Should use original column name
          fieldType: FieldType.Formula,
          dbGenerated: false,
        },
      });
    });

    it('should handle formula fields without options', async () => {
      const mockFields = [
        {
          id: 'fld1',
          dbFieldName: 'field1',
          type: FieldType.Formula,
          options: null,
        },
      ];

      mockFieldFindMany.mockResolvedValue(mockFields);

      const fieldMap = await formulaFieldService.buildFieldMapForTable('tbl123');

      expect(fieldMap).toEqual({
        fld1: {
          columnName: 'field1', // Should use original column name when options is null
          fieldType: FieldType.Formula,
          dbGenerated: false,
        },
      });
    });

    it('should handle invalid JSON in options gracefully', async () => {
      const mockFields = [
        {
          id: 'fld1',
          dbFieldName: 'field1',
          type: FieldType.Formula,
          options: 'invalid json string',
        },
      ];

      mockFieldFindMany.mockResolvedValue(mockFields);

      const fieldMap = await formulaFieldService.buildFieldMapForTable('tbl123');

      expect(fieldMap).toEqual({
        fld1: {
          columnName: 'field1', // Should use original column name when JSON parsing fails
          fieldType: FieldType.Formula,
          dbGenerated: false,
        },
      });
    });
  });

  describe('Formula field references in generated columns', () => {
    it('should reference generated column when formula field references another formula field with dbGenerated=true', async () => {
      // Setup: field1 is a regular field, field2 is a formula with dbGenerated=true,
      // field3 is a formula that references field2
      const mockFields = [
        {
          id: 'fld1',
          dbFieldName: 'field1',
          type: FieldType.SingleLineText,
          options: null,
        },
        {
          id: 'fld2',
          dbFieldName: 'field2',
          type: FieldType.Formula,
          options: JSON.stringify({ expression: '{fld1} + " processed"', dbGenerated: true }),
        },
        {
          id: 'fld3',
          dbFieldName: 'field3',
          type: FieldType.Formula,
          options: JSON.stringify({ expression: '{fld2} + " final"', dbGenerated: true }),
        },
      ];

      mockFieldFindMany.mockResolvedValue(mockFields);

      // Mock the formula conversion to capture the context
      let capturedContext: IFormulaConversionContext | undefined;
      mockDbProvider.convertFormula.mockImplementation(
        (expression: string, context: IFormulaConversionContext) => {
          capturedContext = context;
          return { sql: 'mock_sql', dependencies: [] };
        }
      );

      const fieldMap = await formulaFieldService.buildFieldMapForTable('tbl123');

      // Verify that field2 uses generated column name in the field map
      expect(fieldMap.fld2.columnName).toBe(getGeneratedColumnName('field2'));
      expect(fieldMap.fld2.dbGenerated).toBe(true);

      // When field3 references field2, it should get the generated column name
      expect(fieldMap.fld2.columnName).toBe(getGeneratedColumnName('field2'));
    });
  });
});
