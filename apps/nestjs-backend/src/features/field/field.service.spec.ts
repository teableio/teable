/* eslint-disable sonarjs/no-duplicate-string */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { CellValueType, DbFieldType, FieldType, OpName } from '@teable/core';
import type { IFieldVo, INumberFormatting, ISetFieldPropertyOpContext } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { GlobalModule } from '../../global/global.module';
import { FieldModule } from './field.module';
import { FieldService } from './field.service';
import { applyFieldPropertyOpsAndCreateInstance } from './model/factory';

describe('FieldService', () => {
  let service: FieldService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, FieldModule],
    }).compile();

    service = module.get<FieldService>(FieldService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reads table metadata from the active transaction when routing asks for it', async () => {
    const txFindUnique = vi.fn().mockResolvedValue({ dbTableName: 'bse_test.tbl_tx' });
    const rootFindUnique = vi.fn();
    const service = Object.create(FieldService.prototype) as FieldService;
    Object.assign(service, {
      prismaService: {
        txClient: vi.fn(() => ({
          tableMeta: {
            findUnique: txFindUnique,
          },
        })),
        tableMeta: {
          findUnique: rootFindUnique,
        },
      } as unknown as PrismaService,
    });

    await expect(service.getDbTableName('tbl_tx', { useTransaction: true })).resolves.toBe(
      'bse_test.tbl_tx'
    );
    expect(txFindUnique).toHaveBeenCalledWith({
      where: { id: 'tbl_tx' },
      select: { dbTableName: true },
    });
    expect(rootFindUnique).not.toHaveBeenCalled();
  });

  describe('applyFieldPropertyOpsAndCreateInstance', () => {
    it('should apply field property operations and return field instance', () => {
      // Create a mock field VO
      const mockFieldVo: IFieldVo = {
        id: 'fld123',
        name: 'Original Name',
        type: FieldType.SingleLineText,
        dbFieldName: 'fld_original',
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        options: {},
      };

      // Create mock operations
      const ops: ISetFieldPropertyOpContext[] = [
        {
          name: OpName.SetFieldProperty,
          key: 'name',
          newValue: 'Updated Name',
          oldValue: 'Original Name',
        },
        {
          name: OpName.SetFieldProperty,
          key: 'description',
          newValue: 'New description',
          oldValue: undefined,
        },
      ];

      // Apply operations
      const result = applyFieldPropertyOpsAndCreateInstance(mockFieldVo, ops);

      // Verify the result is a field instance
      expect(result).toBeDefined();
      expect(result.id).toBe('fld123');
      expect(result.name).toBe('Updated Name');
      expect(result.description).toBe('New description');
      expect(result.type).toBe(FieldType.SingleLineText);

      // Verify original field VO is not modified
      expect(mockFieldVo.name).toBe('Original Name');
      expect(mockFieldVo.description).toBeUndefined();
    });

    it('should handle empty operations array', () => {
      const mockFieldVo: IFieldVo = {
        id: 'fld123',
        name: 'Test Field',
        type: FieldType.Number,
        dbFieldName: 'fld_test',
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        options: {
          formatting: {
            type: 'decimal',
            precision: 2,
          } as INumberFormatting,
        },
      };

      const result = applyFieldPropertyOpsAndCreateInstance(mockFieldVo, []);

      expect(result).toBeDefined();
      expect(result.id).toBe('fld123');
      expect(result.name).toBe('Test Field');
      expect(result.type).toBe(FieldType.Number);
    });
  });
});
