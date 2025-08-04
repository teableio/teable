/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { FormulaFieldService } from './formula-field.service';

describe('FormulaFieldService', () => {
  let service: FormulaFieldService;
  let prismaService: PrismaService;
  let module: TestingModule;

  // Test data IDs - using consistent IDs for easier debugging
  const testTableId = 'tbl_test_table';
  const fieldIds = {
    textA: 'fld_text_a',
    formulaB: 'fld_formula_b',
    formulaC: 'fld_formula_c',
    formulaD: 'fld_formula_d',
    formulaE: 'fld_formula_e',
    lookupF: 'fld_lookup_f',
    textG: 'fld_text_g',
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        FormulaFieldService,
        {
          provide: PrismaService,
          useValue: {
            txClient: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FormulaFieldService>(FormulaFieldService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await module.close();
  });

  describe('getDependentFormulaFieldsInOrder', () => {
    let mockQueryRawUnsafe: any;

    beforeEach(() => {
      mockQueryRawUnsafe = vi.fn();
      vi.mocked(prismaService.txClient).mockReturnValue({
        $queryRawUnsafe: mockQueryRawUnsafe,
        field: {
          create: vi.fn(),
          deleteMany: vi.fn(),
        },
        reference: {
          create: vi.fn(),
          deleteMany: vi.fn(),
        },
      } as any);
    });

    it('should return empty array when no dependencies exist', async () => {
      // Mock empty result
      const mockQueryResult: any[] = [];
      mockQueryRawUnsafe.mockResolvedValue(mockQueryResult);

      const result = await service.getDependentFormulaFieldsInOrder(fieldIds.textA);

      expect(result).toEqual([]);
      expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('WITH RECURSIVE dependent_fields'),
        fieldIds.textA,
        FieldType.Formula
      );
    });

    it('should handle single level dependencies (A → B)', async () => {
      // Mock result: textA → formulaB
      const mockQueryResult = [{ id: fieldIds.formulaB, table_id: testTableId, level: 1 }];
      mockQueryRawUnsafe.mockResolvedValue(mockQueryResult);

      const result = await service.getDependentFormulaFieldsInOrder(fieldIds.textA);

      expect(result).toEqual([{ id: fieldIds.formulaB, tableId: testTableId, level: 1 }]);
    });

    it('should handle multi-level dependencies with correct topological order (A → B → C)', async () => {
      // Mock result: textA → formulaB → formulaC
      // Should return in deepest-first order (level 2, then level 1)
      const mockQueryResult = [
        { id: fieldIds.formulaC, table_id: testTableId, level: 2 },
        { id: fieldIds.formulaB, table_id: testTableId, level: 1 },
      ];
      mockQueryRawUnsafe.mockResolvedValue(mockQueryResult);

      const result = await service.getDependentFormulaFieldsInOrder(fieldIds.textA);

      expect(result).toEqual([
        { id: fieldIds.formulaC, tableId: testTableId, level: 2 },
        { id: fieldIds.formulaB, tableId: testTableId, level: 1 },
      ]);

      // Verify topological order: deeper levels come first
      expect(result[0].level).toBeGreaterThan(result[1].level);
    });

    it('should handle multiple branches (A → B, A → C)', async () => {
      // Mock result: textA → formulaB, textA → formulaC
      const mockQueryResult = [
        { id: fieldIds.formulaB, table_id: testTableId, level: 1 },
        { id: fieldIds.formulaC, table_id: testTableId, level: 1 },
      ];
      mockQueryRawUnsafe.mockResolvedValue(mockQueryResult);

      const result = await service.getDependentFormulaFieldsInOrder(fieldIds.textA);

      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([
          { id: fieldIds.formulaB, tableId: testTableId, level: 1 },
          { id: fieldIds.formulaC, tableId: testTableId, level: 1 },
        ])
      );

      // All should be at same level
      expect(result.every((f) => f.level === 1)).toBe(true);
    });

    it('should handle complex dependency trees (A → B → D, A → C → E)', async () => {
      // Mock result: Complex tree with multiple paths
      const mockQueryResult = [
        { id: fieldIds.formulaD, table_id: testTableId, level: 2 }, // B → D
        { id: fieldIds.formulaE, table_id: testTableId, level: 2 }, // C → E
        { id: fieldIds.formulaB, table_id: testTableId, level: 1 }, // A → B
        { id: fieldIds.formulaC, table_id: testTableId, level: 1 }, // A → C
      ];
      mockQueryRawUnsafe.mockResolvedValue(mockQueryResult);

      const result = await service.getDependentFormulaFieldsInOrder(fieldIds.textA);

      expect(result).toHaveLength(4);

      // Verify topological ordering
      const level2Fields = result.filter((f) => f.level === 2);
      const level1Fields = result.filter((f) => f.level === 1);

      expect(level2Fields).toHaveLength(2);
      expect(level1Fields).toHaveLength(2);

      // Level 2 fields should come before level 1 fields in the result
      const firstLevel2Index = result.findIndex((f) => f.level === 2);
      const lastLevel1Index = result.map((f) => f.level).lastIndexOf(1);
      expect(firstLevel2Index).toBeLessThan(lastLevel1Index);
    });
  });

  describe('SQL Query Validation', () => {
    it('should call $queryRawUnsafe with correct SQL structure', async () => {
      const mockQueryResult: any[] = [];
      vi.mocked(prismaService.txClient().$queryRawUnsafe).mockResolvedValue(mockQueryResult);

      await service.getDependentFormulaFieldsInOrder(fieldIds.textA);

      const [sqlQuery, fieldId, fieldType] = vi.mocked(prismaService.txClient().$queryRawUnsafe)
        .mock.calls[0];

      // Verify SQL structure
      expect(sqlQuery).toContain('WITH RECURSIVE dependent_fields AS');
      expect(sqlQuery).toContain('SELECT');
      expect(sqlQuery).toContain('UNION ALL');
      expect(sqlQuery).toContain('ORDER BY df.level DESC');
      expect(sqlQuery).toContain('WHERE df.level < 10'); // Recursion limit

      // Verify parameters
      expect(fieldId).toBe(fieldIds.textA);
      expect(fieldType).toBe(FieldType.Formula);
    });

    it('should include recursion prevention in SQL', async () => {
      const mockQueryResult: any[] = [];
      vi.mocked(prismaService.txClient().$queryRawUnsafe).mockResolvedValue(mockQueryResult);

      await service.getDependentFormulaFieldsInOrder(fieldIds.textA);

      const [sqlQuery] = vi.mocked(prismaService.txClient().$queryRawUnsafe).mock.calls[0];

      // Should have recursion limit to prevent infinite loops
      expect(sqlQuery).toContain('WHERE df.level < 10');
    });

    it('should filter only formula fields and non-deleted fields', async () => {
      const mockQueryResult: any[] = [];
      vi.mocked(prismaService.txClient().$queryRawUnsafe).mockResolvedValue(mockQueryResult);

      await service.getDependentFormulaFieldsInOrder(fieldIds.textA);

      const [sqlQuery] = vi.mocked(prismaService.txClient().$queryRawUnsafe).mock.calls[0];

      // Should filter by field type and deletion status
      expect(sqlQuery).toContain('WHERE f.type = $2');
      expect(sqlQuery).toContain('AND f.deleted_time IS NULL');
    });
  });

  describe('Edge Cases', () => {
    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      vi.mocked(prismaService.txClient().$queryRawUnsafe).mockRejectedValue(dbError);

      await expect(service.getDependentFormulaFieldsInOrder(fieldIds.textA)).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should handle malformed database results', async () => {
      // Mock malformed result (missing required fields)
      const mockQueryResult = [
        { id: fieldIds.formulaB }, // Missing table_id and level
      ];
      vi.mocked(prismaService.txClient().$queryRawUnsafe).mockResolvedValue(mockQueryResult);

      const result = await service.getDependentFormulaFieldsInOrder(fieldIds.textA);

      expect(result).toEqual([{ id: fieldIds.formulaB, tableId: undefined, level: undefined }]);
    });

    it('should handle very deep dependency chains', async () => {
      // Mock a deep chain (level 9, near the recursion limit)
      const mockQueryResult = Array.from({ length: 9 }, (_, i) => ({
        id: `fld_formula_${i + 1}`,
        table_id: testTableId,
        level: i + 1,
      })).reverse(); // Should be ordered deepest first

      vi.mocked(prismaService.txClient().$queryRawUnsafe).mockResolvedValue(mockQueryResult);

      const result = await service.getDependentFormulaFieldsInOrder(fieldIds.textA);

      expect(result).toHaveLength(9);
      expect(result[0].level).toBe(9); // Deepest first
      expect(result[8].level).toBe(1); // Shallowest last

      // Verify descending order
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].level).toBeGreaterThanOrEqual(result[i + 1].level);
      }
    });
  });
});
