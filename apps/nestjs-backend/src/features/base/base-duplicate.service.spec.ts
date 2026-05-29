import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType, Relationship } from '@teable/core';
import { BaseDuplicateMode } from '@teable/openapi';
import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
import { TableByIdSpec, v2CoreTokens } from '@teable/v2-core';
import { GlobalModule } from '../../global/global.module';
import { BaseDuplicateService } from './base-duplicate.service';
import type { BaseImportProgressCallback, IBaseImportProgress } from './base-import.service';
import { BaseModule } from './base.module';
import type { ILinkFieldTableMap } from './utils';

describe('BaseDuplicateService', () => {
  let service: BaseDuplicateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, BaseModule],
    }).compile();

    service = module.get<BaseDuplicateService>(BaseDuplicateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('BaseDuplicateService normalizeDuplicateStructureForV2', () => {
  it('preserves same-space cross-base link fields outside the duplicated table set', () => {
    const service = Object.create(BaseDuplicateService.prototype) as BaseDuplicateService;
    const internals = service as unknown as {
      normalizeDuplicateStructureForV2: (structure: unknown) => {
        tables: { fields: { id?: string; type: string }[] }[];
      };
    };

    const normalized = internals.normalizeDuplicateStructureForV2({
      id: 'bseSource',
      name: 'Source',
      tables: [
        {
          id: 'tblLocal',
          name: 'Local',
          fields: [
            {
              id: 'fldVendor',
              name: 'Vendor',
              type: FieldType.Link,
              options: {
                baseId: 'bseExternal',
                relationship: Relationship.ManyMany,
                foreignTableId: 'tblExternal',
                lookupFieldId: 'fldExternalName',
              },
            },
            {
              id: 'fldDisconnected',
              name: 'Disconnected',
              type: FieldType.Link,
              options: {
                relationship: Relationship.ManyMany,
                foreignTableId: 'tblMissing',
                lookupFieldId: 'fldMissingName',
              },
            },
          ],
          views: [],
        },
      ],
    });

    const fields = normalized.tables[0].fields;
    expect(fields.find(({ id }) => id === 'fldVendor')?.type).toBe(FieldType.Link);
    expect(fields.find(({ id }) => id === 'fldDisconnected')?.type).toBe(FieldType.SingleLineText);
  });

  it('does not treat lookup fields with link result type as host link fields', () => {
    const service = Object.create(BaseDuplicateService.prototype) as BaseDuplicateService;
    const internals = service as unknown as {
      normalizeDuplicateStructureForV2: (structure: unknown) => {
        tables: { fields: { id?: string; type: string; options?: unknown }[] }[];
      };
    };

    const hostTableId = 'tblHost';
    const foreignTableId = 'tblForeign';
    const linkResultLookupFieldId = 'fldLinkResultLookup';
    const dependentLookupFieldId = 'fldDependentLookup';
    const lookupFieldId = 'fldForeignName';

    const normalized = internals.normalizeDuplicateStructureForV2({
      id: 'bseSource',
      name: 'Source',
      tables: [
        {
          id: hostTableId,
          name: 'Host',
          fields: [
            {
              id: 'fldPrimary',
              name: 'Name',
              type: FieldType.SingleLineText,
              isPrimary: true,
            },
            {
              id: linkResultLookupFieldId,
              name: 'Lookup link result',
              type: FieldType.Link,
              isLookup: true,
            },
            {
              id: dependentLookupFieldId,
              name: 'Lookup through lookup result',
              type: FieldType.SingleLineText,
              isLookup: true,
              lookupOptions: {
                linkFieldId: linkResultLookupFieldId,
                foreignTableId,
                lookupFieldId,
              },
            },
          ],
          views: [],
        },
        {
          id: foreignTableId,
          name: 'Foreign',
          fields: [
            {
              id: lookupFieldId,
              name: 'Name',
              type: FieldType.SingleLineText,
              isPrimary: true,
            },
          ],
          views: [],
        },
      ],
    });

    const fields = normalized.tables[0].fields;
    expect(fields.find(({ id }) => id === linkResultLookupFieldId)?.type).toBe(
      FieldType.SingleLineText
    );
    expect(fields.find(({ id }) => id === dependentLookupFieldId)?.type).toBe(
      FieldType.SingleLineText
    );
  });
});

describe('BaseDuplicateService duplicateBaseV2', () => {
  const okResult = <T>(value: T) => ({ isErr: () => false, value });
  type IServiceArgs = ConstructorParameters<typeof BaseDuplicateService>;
  const duplicateBaseName = 'Duplicated base';
  const sourceTableName = 'Source table';
  const sourceDbTableName = 'bseSource.tblSource';

  type IDuplicateServiceInternals = {
    buildDuplicateStructureConfig: (...args: unknown[]) => Promise<unknown>;
    getCrossBaseLinkFieldTableMap: (...args: unknown[]) => Promise<ILinkFieldTableMap>;
    getDisconnectedLinkFieldTableMap: (...args: unknown[]) => Promise<ILinkFieldTableMap>;
    getDisconnectedLinkFieldIds: (...args: unknown[]) => Promise<string[]>;
    normalizeDuplicateStructureForV2: (structure: unknown) => unknown;
    createDuplicateBaseSource: (...args: unknown[]) => {
      records(tableId: string): AsyncIterable<{ fields: Record<string, unknown> }>;
    };
    duplicateTableData: (...args: unknown[]) => Promise<number>;
    duplicateAttachments: (...args: unknown[]) => Promise<void>;
    duplicateLinkJunction: (...args: unknown[]) => Promise<void>;
    backfillDuplicatedBaseComputedFields: (...args: unknown[]) => Promise<void>;
  };

  it('should create the v2 execution context from the space data container', async () => {
    const spaceId = 'spcTarget';
    const targetBaseId = 'bseTarget';
    const tableIdMap = { tblSource: 'tblTarget' };
    const context = { requestId: 'ctx' };
    const db = { dialect: 'pg' };
    const structure = {
      name: duplicateBaseName,
      icon: undefined,
      tables: [{ id: 'tblSource', name: sourceTableName, fields: [], views: [] }],
    };
    const source = {
      structure,
      records: async function* () {
        yield undefined as never;
      },
    };
    const commandBus = {
      execute: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: (async function* () {
          yield {
            id: 'done',
            baseId: targetBaseId,
            tableIdMap,
            fieldIdMap: {},
            viewIdMap: {},
            recordsLength: 0,
          };
        })(),
      }),
    };
    const container = {
      resolve: vi.fn().mockReturnValueOnce(commandBus).mockReturnValueOnce(db),
    };
    const baseImportService = {
      createBaseV2: vi.fn().mockResolvedValue({ id: targetBaseId }),
      restoreBaseExtrasV2: vi.fn().mockResolvedValue({ appIdMap: {}, workflowIdMap: {} }),
    };
    const v2ContainerService = {
      getContainerForSpace: vi.fn().mockResolvedValue(container),
    };
    const v2ContextFactory = {
      createContext: vi.fn().mockResolvedValue(context),
    };

    const service = new BaseDuplicateService(
      {
        txClient: vi.fn().mockReturnValue({
          base: { update: vi.fn() },
        }),
      } as unknown as IServiceArgs[0],
      {} as IServiceArgs[1],
      {} as IServiceArgs[2],
      baseImportService as unknown as IServiceArgs[3],
      {} as IServiceArgs[4],
      {} as IServiceArgs[5],
      {} as IServiceArgs[6],
      { get: vi.fn().mockReturnValue('usrTest') } as unknown as IServiceArgs[7],
      {} as IServiceArgs[8],
      {} as IServiceArgs[9],
      v2ContainerService as unknown as IServiceArgs[10],
      v2ContextFactory as unknown as IServiceArgs[11]
    );
    const internals = service as unknown as IDuplicateServiceInternals;

    const sourceDbTableNameByTableId = { tblSource: sourceDbTableName };

    vi.spyOn(internals, 'buildDuplicateStructureConfig').mockResolvedValue({
      structure,
      sourceDbTableNameByTableId,
    });
    vi.spyOn(internals, 'getCrossBaseLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getDisconnectedLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getDisconnectedLinkFieldIds').mockResolvedValue([]);
    vi.spyOn(internals, 'normalizeDuplicateStructureForV2').mockReturnValue(structure);
    vi.spyOn(internals, 'createDuplicateBaseSource').mockReturnValue(source);

    await service.duplicateBaseV2({
      fromBaseId: 'bseSource',
      spaceId,
      name: duplicateBaseName,
      withRecords: false,
    });

    expect(v2ContainerService.getContainerForSpace).toHaveBeenCalledWith(spaceId);
    expect(v2ContextFactory.createContext).toHaveBeenCalledWith(container);
    expect(internals.createDuplicateBaseSource).toHaveBeenCalledWith(
      'bseSource',
      structure,
      {},
      sourceDbTableNameByTableId
    );
    expect(commandBus.execute).toHaveBeenCalledWith(context, expect.any(Object));
  });

  it('should create v2 structure first and copy records with raw table duplication', async () => {
    const spaceId = 'spcTarget';
    const targetBaseId = 'bseTarget';
    const tableIdMap = { tblSource: 'tblTarget' };
    const fieldIdMap = { fldLink: 'fldTargetLink' };
    const viewIdMap = { viwSource: 'viwTarget' };
    const context = { requestId: 'ctx' };
    const db = { dialect: 'pg' };
    const structure = {
      name: duplicateBaseName,
      icon: undefined,
      tables: [{ id: 'tblSource', name: sourceTableName, fields: [], views: [] }],
    };
    const source = {
      structure,
      records: async function* () {
        yield undefined as never;
      },
    };
    const commandBus = {
      execute: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: (async function* () {
          yield {
            id: 'done',
            baseId: targetBaseId,
            tableIdMap,
            fieldIdMap,
            viewIdMap,
            recordsLength: 0,
          };
        })(),
      }),
    };
    const container = {
      resolve: vi.fn().mockReturnValueOnce(commandBus).mockReturnValueOnce(db),
    };
    const baseUpdate = vi.fn();
    const baseImportService = {
      createBaseV2: vi.fn().mockResolvedValue({ id: targetBaseId }),
      restoreBaseExtrasV2: vi.fn().mockResolvedValue({ appIdMap: {}, workflowIdMap: {} }),
    };
    const persistedComputedBackfillService = {
      recomputeForTables: vi.fn().mockResolvedValue(undefined),
    };
    const dataDbClientManager = {
      getDataDatabaseForBase: vi.fn().mockResolvedValue({ cacheKey: 'same-db' }),
    };
    const v2ContainerService = {
      getContainerForSpace: vi.fn().mockResolvedValue(container),
    };
    const v2ContextFactory = {
      createContext: vi.fn().mockResolvedValue(context),
    };

    const service = new BaseDuplicateService(
      {
        txClient: vi.fn().mockReturnValue({
          base: { update: baseUpdate },
        }),
      } as unknown as IServiceArgs[0],
      {} as IServiceArgs[1],
      {} as IServiceArgs[2],
      baseImportService as unknown as IServiceArgs[3],
      {} as IServiceArgs[4],
      {} as IServiceArgs[5],
      persistedComputedBackfillService as unknown as IServiceArgs[6],
      { get: vi.fn().mockReturnValue('usrTest') } as unknown as IServiceArgs[7],
      {} as IServiceArgs[8],
      dataDbClientManager as unknown as IServiceArgs[9],
      v2ContainerService as unknown as IServiceArgs[10],
      v2ContextFactory as unknown as IServiceArgs[11]
    );
    const internals = service as unknown as IDuplicateServiceInternals;
    const mergedLinkFieldTableMap = {
      tblSource: [{ dbFieldName: 'fldLink', selfKeyName: '__id', isMultipleCellValue: true }],
    };

    vi.spyOn(internals, 'buildDuplicateStructureConfig').mockResolvedValue({
      structure,
      sourceDbTableNameByTableId: { tblSource: sourceDbTableName },
    });
    vi.spyOn(internals, 'getCrossBaseLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getDisconnectedLinkFieldTableMap').mockResolvedValue(
      mergedLinkFieldTableMap
    );
    vi.spyOn(internals, 'getDisconnectedLinkFieldIds').mockResolvedValue(['fldDisconnected']);
    vi.spyOn(internals, 'normalizeDuplicateStructureForV2').mockReturnValue(structure);
    vi.spyOn(internals, 'createDuplicateBaseSource').mockReturnValue(source);
    vi.spyOn(internals, 'duplicateTableData').mockResolvedValue(12);
    vi.spyOn(internals, 'duplicateAttachments').mockResolvedValue(undefined);
    vi.spyOn(internals, 'duplicateLinkJunction').mockResolvedValue(undefined);
    vi.spyOn(internals, 'backfillDuplicatedBaseComputedFields').mockResolvedValue(undefined);

    const result = await service.duplicateBaseV2({
      fromBaseId: 'bseSource',
      spaceId,
      name: duplicateBaseName,
      withRecords: true,
    });

    const executedCommand = commandBus.execute.mock.calls[0]?.[1] as { withRecords: boolean };
    expect(executedCommand.withRecords).toBe(false);
    expect(internals.duplicateTableData).toHaveBeenCalledWith(
      targetBaseId,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      mergedLinkFieldTableMap,
      undefined
    );
    expect(internals.duplicateLinkJunction).toHaveBeenCalledWith(
      targetBaseId,
      tableIdMap,
      fieldIdMap,
      true,
      ['fldDisconnected']
    );
    expect(persistedComputedBackfillService.recomputeForTables).toHaveBeenCalledWith(['tblTarget']);
    expect(internals.backfillDuplicatedBaseComputedFields).toHaveBeenCalledWith(
      container,
      context,
      ['tblTarget']
    );
    expect(result.recordsLength).toBe(12);
  });

  it('should synchronously backfill v2 computed and link fields after raw record copy', async () => {
    const targetTableId = 'tblaaaaaaaaaaaaaaaa';
    const context = { requestId: 'ctx' };
    const fields = [{ name: 'Owner' }];
    const table = {
      getFields: vi.fn().mockReturnValue(fields),
    };
    const tableRepository = {
      findOne: vi.fn().mockResolvedValue(okResult(table)),
    };
    const backfillService = {
      executeSyncMany: vi.fn().mockResolvedValue(okResult(undefined)),
    };
    const container = {
      resolve: vi.fn((token: symbol) => {
        if (token === v2CoreTokens.tableRepository) {
          return tableRepository;
        }
        if (token === v2RecordRepositoryPostgresTokens.computedFieldBackfillService) {
          return backfillService;
        }
        throw new Error('Unexpected token');
      }),
    };

    const service = new BaseDuplicateService(
      {} as IServiceArgs[0],
      {} as IServiceArgs[1],
      {} as IServiceArgs[2],
      {} as IServiceArgs[3],
      {} as IServiceArgs[4],
      {} as IServiceArgs[5],
      {} as IServiceArgs[6],
      {} as IServiceArgs[7],
      {} as IServiceArgs[8],
      {} as IServiceArgs[9],
      {} as IServiceArgs[10],
      {} as IServiceArgs[11]
    );
    const internals = service as unknown as IDuplicateServiceInternals;

    await internals.backfillDuplicatedBaseComputedFields(container, context, [targetTableId]);

    expect(container.resolve).toHaveBeenCalledWith(v2CoreTokens.tableRepository);
    expect(container.resolve).toHaveBeenCalledWith(
      v2RecordRepositoryPostgresTokens.computedFieldBackfillService
    );
    expect(tableRepository.findOne).toHaveBeenCalledWith(context, expect.any(TableByIdSpec));
    expect(backfillService.executeSyncMany).toHaveBeenCalledWith(context, {
      table,
      fields,
      skipDistinctFilter: true,
      includeOneManyTwoWay: true,
    });
  });

  it('should forward real row totals through duplicateBaseV2 progress events', async () => {
    const spaceId = 'spcTarget';
    const targetBaseId = 'bseTarget';
    const tableIdMap = { tblSource: 'tblTarget' };
    const fieldIdMap = { fldText: 'fldTargetText' };
    const viewIdMap = { viwSource: 'viwTarget' };
    const context = { requestId: 'ctx' };
    const db = { dialect: 'pg' };
    const structure = {
      name: duplicateBaseName,
      icon: undefined,
      tables: [{ id: 'tblSource', name: sourceTableName, fields: [], views: [] }],
    };
    const source = {
      structure,
      records: async function* () {
        yield undefined as never;
      },
    };
    const commandBus = {
      execute: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: (async function* () {
          yield {
            id: 'done',
            baseId: targetBaseId,
            tableIdMap,
            fieldIdMap,
            viewIdMap,
            recordsLength: 0,
          };
        })(),
      }),
    };
    const container = {
      resolve: vi.fn().mockReturnValueOnce(commandBus).mockReturnValueOnce(db),
    };
    const baseImportService = {
      createBaseV2: vi.fn().mockResolvedValue({ id: targetBaseId }),
      restoreBaseExtrasV2: vi.fn().mockResolvedValue({ appIdMap: {}, workflowIdMap: {} }),
    };
    const persistedComputedBackfillService = {
      recomputeForTables: vi.fn().mockResolvedValue(undefined),
    };
    const dataDbClientManager = {
      getDataDatabaseForBase: vi.fn().mockResolvedValue({ cacheKey: 'same-db' }),
    };
    const v2ContainerService = {
      getContainerForSpace: vi.fn().mockResolvedValue(container),
    };
    const v2ContextFactory = {
      createContext: vi.fn().mockResolvedValue(context),
    };

    const service = new BaseDuplicateService(
      {
        txClient: vi.fn().mockReturnValue({
          base: { update: vi.fn() },
        }),
      } as unknown as IServiceArgs[0],
      {} as IServiceArgs[1],
      {} as IServiceArgs[2],
      baseImportService as unknown as IServiceArgs[3],
      {} as IServiceArgs[4],
      {} as IServiceArgs[5],
      persistedComputedBackfillService as unknown as IServiceArgs[6],
      { get: vi.fn().mockReturnValue('usrTest') } as unknown as IServiceArgs[7],
      {} as IServiceArgs[8],
      dataDbClientManager as unknown as IServiceArgs[9],
      v2ContainerService as unknown as IServiceArgs[10],
      v2ContextFactory as unknown as IServiceArgs[11]
    );
    const internals = service as unknown as IDuplicateServiceInternals;
    const progressEvents: unknown[] = [];

    vi.spyOn(internals, 'buildDuplicateStructureConfig').mockResolvedValue({
      structure,
      sourceDbTableNameByTableId: { tblSource: sourceDbTableName },
    });
    vi.spyOn(internals, 'getCrossBaseLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getDisconnectedLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getDisconnectedLinkFieldIds').mockResolvedValue([]);
    vi.spyOn(internals, 'normalizeDuplicateStructureForV2').mockReturnValue(structure);
    vi.spyOn(internals, 'createDuplicateBaseSource').mockReturnValue(source);
    vi.spyOn(internals, 'duplicateTableData').mockImplementation(async (...args: unknown[]) => {
      const onProgress = args[5] as BaseImportProgressCallback | undefined;
      onProgress?.({ phase: 'table_data_start', processedRows: 0, totalRows: 12 });
      onProgress?.({
        phase: 'table_data_progress',
        tableId: 'tblTarget',
        tableName: sourceTableName,
        processedRows: 5,
        batchProcessedRows: 5,
        currentBatch: 1,
        totalRows: 12,
      });
      onProgress?.({ phase: 'table_data_done', processedRows: 12, totalRows: 12 });
      return 12;
    });
    vi.spyOn(internals, 'duplicateAttachments').mockResolvedValue(undefined);
    vi.spyOn(internals, 'duplicateLinkJunction').mockResolvedValue(undefined);
    vi.spyOn(internals, 'backfillDuplicatedBaseComputedFields').mockResolvedValue(undefined);

    const result = await service.duplicateBaseV2(
      {
        fromBaseId: 'bseSource',
        spaceId,
        name: duplicateBaseName,
        withRecords: true,
      },
      true,
      BaseDuplicateMode.Normal,
      (event: string | IBaseImportProgress) => progressEvents.push(event)
    );

    expect(internals.duplicateTableData).toHaveBeenCalledWith(
      targetBaseId,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      {},
      expect.any(Function)
    );
    expect(progressEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'table_data_start', processedRows: 0, totalRows: 12 }),
        expect.objectContaining({
          phase: 'table_data_progress',
          processedRows: 5,
          batchProcessedRows: 5,
          totalRows: 12,
        }),
        expect.objectContaining({ phase: 'table_data_done', processedRows: 12, totalRows: 12 }),
        expect.objectContaining({ phase: 'attachments_copying', processedRows: 12, totalRows: 12 }),
        expect.objectContaining({ phase: 'duplicate_done', processedRows: 12, totalRows: 12 }),
      ])
    );
    expect(result.recordsLength).toBe(12);
  });

  it('should aggregate table copy batches into global duplicate progress', async () => {
    const dataPrisma = {
      $queryRawUnsafe: vi.fn((query: string) => {
        if (query.includes('source_a') && query.includes('count')) {
          return Promise.resolve([{ count: 3 }]);
        }
        if (query.includes('source_b') && query.includes('count')) {
          return Promise.resolve([{ count: 2 }]);
        }
        return Promise.resolve([]);
      }),
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    };
    const tableDuplicateService = {
      duplicateTableData: vi.fn(
        async (
          sourceDbTableName: string,
          _targetDbTableName: string,
          _viewIdMap: Record<string, string>,
          _fieldIdMap: Record<string, string>,
          _crossBaseLinkInfo: unknown[],
          _dataPrisma: unknown,
          options?: {
            onProgress?: (progress: {
              batchProcessedRows: number;
              currentBatch: number;
              processedRows: number;
              totalRows: number;
            }) => void;
          }
        ) => {
          const batchProcessedRows = sourceDbTableName === 'source_a' ? 3 : 2;
          options?.onProgress?.({
            batchProcessedRows,
            currentBatch: 1,
            processedRows: batchProcessedRows,
            totalRows: batchProcessedRows,
          });
          return batchProcessedRows;
        }
      ),
    };
    const metaPrisma = {
      tableMeta: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'tblA', dbTableName: 'source_a', name: 'A' },
          { id: 'tblB', dbTableName: 'source_b', name: 'B' },
          { id: 'tblTargetA', dbTableName: 'target_a', name: 'A Copy' },
          { id: 'tblTargetB', dbTableName: 'target_b', name: 'B Copy' },
        ]),
      },
    };
    const knex = vi.fn((tableName: string) => ({
      count: vi.fn().mockReturnValue({
        toQuery: () => `select count(*) from ${tableName}`,
      }),
    }));
    const progressEvents: unknown[] = [];
    const service = new BaseDuplicateService(
      {
        txClient: vi.fn().mockReturnValue(metaPrisma),
      } as unknown as IServiceArgs[0],
      tableDuplicateService as unknown as IServiceArgs[1],
      {} as IServiceArgs[2],
      {} as IServiceArgs[3],
      {
        getForeignKeysInfo: vi.fn().mockReturnValue('select foreign keys'),
      } as unknown as IServiceArgs[4],
      knex as unknown as IServiceArgs[5],
      {} as IServiceArgs[6],
      {} as IServiceArgs[7],
      {} as IServiceArgs[8],
      {
        dataPrismaForBase: vi.fn().mockResolvedValue(dataPrisma),
      } as unknown as IServiceArgs[9],
      {} as IServiceArgs[10],
      {} as IServiceArgs[11]
    );
    const internals = service as unknown as IDuplicateServiceInternals;

    const recordsLength = await internals.duplicateTableData(
      'bseTarget',
      { tblA: 'tblTargetA', tblB: 'tblTargetB' },
      {},
      {},
      {},
      (event: string | IBaseImportProgress) => progressEvents.push(event)
    );

    expect(recordsLength).toBe(5);
    expect(progressEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'table_data_start', processedRows: 0, totalRows: 5 }),
        expect.objectContaining({
          phase: 'table_data_progress',
          tableId: 'tblTargetA',
          tableName: 'A',
          processedRows: 3,
          batchProcessedRows: 3,
          totalRows: 5,
        }),
        expect.objectContaining({
          phase: 'table_data_progress',
          tableId: 'tblTargetB',
          tableName: 'B',
          processedRows: 5,
          batchProcessedRows: 2,
          totalRows: 5,
        }),
        expect.objectContaining({ phase: 'table_data_done', processedRows: 5, totalRows: 5 }),
      ])
    );
  });

  it('should read source records from the full source db table name', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValueOnce([{ __id: 'recSource', __auto_number: 1, fldText: 'A' }])
        .mockResolvedValueOnce([]),
    };
    const dataKnex = vi.fn().mockReturnValue(query);
    const service = new BaseDuplicateService(
      {} as IServiceArgs[0],
      {} as IServiceArgs[1],
      {} as IServiceArgs[2],
      {} as IServiceArgs[3],
      {} as IServiceArgs[4],
      {} as IServiceArgs[5],
      {} as IServiceArgs[6],
      {} as IServiceArgs[7],
      {} as IServiceArgs[8],
      {
        dataKnexForBase: vi.fn().mockResolvedValue(dataKnex),
      } as unknown as IServiceArgs[9],
      {} as IServiceArgs[10],
      {} as IServiceArgs[11]
    );
    const internals = service as unknown as IDuplicateServiceInternals;
    const source = internals.createDuplicateBaseSource(
      'bseSource',
      {
        name: duplicateBaseName,
        tables: [
          {
            id: 'tblSource',
            name: sourceTableName,
            dbTableName: 'tblShortName',
            fields: [
              {
                id: 'fldText',
                name: 'Text',
                dbFieldName: 'fldText',
                type: FieldType.SingleLineText,
              },
            ],
            views: [],
          },
        ],
      },
      {},
      { tblSource: 'bseSource.tblShortName' }
    );

    const records = [];
    for await (const record of source.records('tblSource')) {
      records.push(record);
    }

    expect(dataKnex).toHaveBeenCalledWith('bseSource.tblShortName');
    expect(records).toEqual([
      {
        recordId: 'recSource',
        fields: { fldText: 'A' },
        autoNumber: 1,
      },
    ]);
  });
});
