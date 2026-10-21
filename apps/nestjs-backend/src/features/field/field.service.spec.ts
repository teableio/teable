/* eslint-disable sonarjs/no-duplicate-string */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { CellValueType, DbFieldType, FieldType, OpName } from '@teable/core';
import type { IFieldVo, INumberFormatting, ISetFieldPropertyOpContext } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
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

  describe('generateDbFieldName', () => {
    const buildService = ({
      columns,
      liveFieldNames,
    }: {
      columns: string[];
      liveFieldNames: string[];
    }) => {
      const service = Object.create(FieldService.prototype) as FieldService;
      Object.assign(service, {
        prismaService: {
          txClient: vi.fn(() => ({
            field: {
              findMany: vi
                .fn()
                .mockResolvedValue(liveFieldNames.map((dbFieldName) => ({ dbFieldName }))),
            },
          })),
        },
        dataLoaderService: {
          table: { loadByIds: vi.fn().mockResolvedValue([{ dbTableName: 'bse_test.tbl_x' }]) },
        },
        dbProvider: { columnInfo: vi.fn(() => 'select column info') },
        databaseRouter: {
          queryDataPrismaForTable: vi.fn().mockResolvedValue(columns.map((name) => ({ name }))),
        },
      });
      return service;
    };

    it('returns the slugified name when it is unused', async () => {
      const service = buildService({ columns: ['Other'], liveFieldNames: ['Another'] });
      await expect(service.generateDbFieldName('tbl_x', 'My Field')).resolves.toBe('My_Field');
    });

    it('suffixes when a physical column already uses the name', async () => {
      const service = buildService({ columns: ['My_Field'], liveFieldNames: [] });
      const dbFieldName = await service.generateDbFieldName('tbl_x', 'My Field');
      expect(dbFieldName).not.toBe('My_Field');
      expect(dbFieldName).toMatch(/^My_Field\d+$/);
    });

    it('suffixes when a live field row reserves the name even without a physical column', async () => {
      const service = buildService({ columns: [], liveFieldNames: ['My_Field'] });
      const dbFieldName = await service.generateDbFieldName('tbl_x', 'My Field');
      expect(dbFieldName).not.toBe('My_Field');
      expect(dbFieldName).toMatch(/^My_Field\d+$/);
    });

    it('reserves generated names within a batch', async () => {
      const service = buildService({ columns: [], liveFieldNames: [] });
      const dbFieldNames = await service.generateDbFieldNames('tbl_x', ['My Field', 'My Field']);
      expect(dbFieldNames[0]).toBe('My_Field');
      expect(dbFieldNames[1]).toMatch(/^My_Field\d+$/);
      expect(new Set(dbFieldNames).size).toBe(2);
    });
  });

  describe('del', () => {
    const fieldRaw = {
      id: 'fldA',
      tableId: 'tbl_x',
      name: 'My Field',
      dbFieldName: 'My_Field',
      type: FieldType.SingleLineText,
      options: '{}',
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
      version: 1,
    };

    const buildService = ({ sharedFieldNames }: { sharedFieldNames: string[] }) => {
      const service = Object.create(FieldService.prototype) as FieldService;
      const alterTableDeleteField = vi.fn().mockResolvedValue(undefined);
      Object.assign(service, {
        logger: { warn: vi.fn() },
        cls: { get: vi.fn(() => 'usr_test') },
        prismaService: {
          txClient: vi.fn(() => ({
            field: {
              update: vi.fn().mockResolvedValue(fieldRaw),
              findMany: vi.fn().mockImplementation(({ where }) => {
                if (where.dbFieldName) {
                  return Promise.resolve(sharedFieldNames.map((dbFieldName) => ({ dbFieldName })));
                }
                return Promise.resolve([fieldRaw]);
              }),
            },
          })),
        },
        dataLoaderService: {
          table: { loadByIds: vi.fn().mockResolvedValue([{ dbTableName: 'bse_test.tbl_x' }]) },
          field: { invalidateTables: vi.fn() },
        },
        alterTableDeleteField,
      });
      return { service, alterTableDeleteField };
    };

    it('drops the column when no live field shares the db field name', async () => {
      const { service, alterTableDeleteField } = buildService({ sharedFieldNames: [] });
      await service.del(2, 'tbl_x', 'fldA');
      expect(alterTableDeleteField).toHaveBeenCalledTimes(1);
      const [, fieldInstances] = alterTableDeleteField.mock.calls[0];
      expect(fieldInstances).toHaveLength(1);
      expect(fieldInstances[0].dbFieldName).toBe('My_Field');
    });

    it('keeps the column when another live field still maps to it', async () => {
      const { service, alterTableDeleteField } = buildService({
        sharedFieldNames: ['My_Field'],
      });
      await service.del(2, 'tbl_x', 'fldA');
      expect(alterTableDeleteField).toHaveBeenCalledTimes(1);
      expect(alterTableDeleteField.mock.calls[0][1]).toHaveLength(0);
    });
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
