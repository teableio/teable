import { Test, TestingModule } from '@nestjs/testing';
import { FieldType, getGeneratedColumnName } from '@teable/core';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { FieldService } from './field.service';
import { FormulaExpansionService } from './formula-expansion.service';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { BatchService } from '../calculation/batch.service';
import { DB_PROVIDER_SYMBOL } from '../../db-provider/db.provider';

describe('Formula Field Reference with Expansion', () => {
  let service: FieldService;
  let formulaExpansionService: FormulaExpansionService;

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

    service = module.get<FieldService>(FieldService);
    formulaExpansionService = module.get<FormulaExpansionService>(FormulaExpansionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('buildFieldMapForTableWithExpansion', () => {
    it('should create expanded expressions for formula fields referencing other formula fields', async () => {
      // Setup: field1 is a regular field, field2 is a formula with dbGenerated=true,
      // field3 is a formula that references field2 (should be expanded)
      const mockFields = [
        {
          id: 'fld1',
          dbFieldName: 'field1',
          type: FieldType.Number,
          options: null,
        },
        {
          id: 'fld2',
          dbFieldName: 'field2',
          type: FieldType.Formula,
          options: JSON.stringify({ expression: '{fld1} + 10', dbGenerated: true }),
        },
        {
          id: 'fld3',
          dbFieldName: 'field3',
          type: FieldType.Formula,
          options: JSON.stringify({ expression: '{fld2} * 2', dbGenerated: true }),
        },
      ];

      mockFieldFindMany.mockResolvedValue(mockFields);

      const buildFieldMapForTableWithExpansion = (
        service as any
      ).buildFieldMapForTableWithExpansion.bind(service);
      const fieldMap = await buildFieldMapForTableWithExpansion('tbl123');

      // field1: regular field, no expansion
      expect(fieldMap.fld1).toEqual({
        columnName: 'field1',
        fieldType: FieldType.Number,
        dbGenerated: false,
      });

      // field2: formula field with dbGenerated=true, but doesn't reference other formula fields
      // Should use generated column name
      expect(fieldMap.fld2).toEqual({
        columnName: getGeneratedColumnName('field2'),
        fieldType: FieldType.Formula,
        dbGenerated: true,
      });

      // field3: formula field that references field2 (another formula field with dbGenerated=true)
      // Should be expanded and use original column name
      expect(fieldMap.fld3).toEqual({
        columnName: 'field3', // Original column name, not generated
        fieldType: FieldType.Formula,
        dbGenerated: true,
        expandedExpression: '({fld1} + 10) * 2', // Expanded expression
      });
    });

    it('should handle nested formula references', async () => {
      const mockFields = [
        {
          id: 'fld1',
          dbFieldName: 'field1',
          type: FieldType.Number,
          options: null,
        },
        {
          id: 'fld2',
          dbFieldName: 'field2',
          type: FieldType.Formula,
          options: JSON.stringify({ expression: '{fld1} + 10', dbGenerated: true }),
        },
        {
          id: 'fld3',
          dbFieldName: 'field3',
          type: FieldType.Formula,
          options: JSON.stringify({ expression: '{fld2} * 2', dbGenerated: true }),
        },
        {
          id: 'fld4',
          dbFieldName: 'field4',
          type: FieldType.Formula,
          options: JSON.stringify({ expression: '{fld3} + 5', dbGenerated: true }),
        },
      ];

      mockFieldFindMany.mockResolvedValue(mockFields);

      const buildFieldMapForTableWithExpansion = (
        service as any
      ).buildFieldMapForTableWithExpansion.bind(service);
      const fieldMap = await buildFieldMapForTableWithExpansion('tbl123');

      // field4 should have deeply nested expansion
      expect(fieldMap.fld4).toEqual({
        columnName: 'field4',
        fieldType: FieldType.Formula,
        dbGenerated: true,
        expandedExpression: '(({fld1} + 10) * 2) + 5',
      });
    });

    it('should not expand formula fields that only reference non-formula fields', async () => {
      const mockFields = [
        {
          id: 'fld1',
          dbFieldName: 'field1',
          type: FieldType.Number,
          options: null,
        },
        {
          id: 'fld2',
          dbFieldName: 'field2',
          type: FieldType.SingleLineText,
          options: null,
        },
        {
          id: 'fld3',
          dbFieldName: 'field3',
          type: FieldType.Formula,
          options: JSON.stringify({ expression: '{fld1} + {fld2}', dbGenerated: true }),
        },
      ];

      mockFieldFindMany.mockResolvedValue(mockFields);

      const buildFieldMapForTableWithExpansion = (
        service as any
      ).buildFieldMapForTableWithExpansion.bind(service);
      const fieldMap = await buildFieldMapForTableWithExpansion('tbl123');

      // field3 only references non-formula fields, should use generated column name
      expect(fieldMap.fld3).toEqual({
        columnName: getGeneratedColumnName('field3'),
        fieldType: FieldType.Formula,
        dbGenerated: true,
      });
    });
  });
});
