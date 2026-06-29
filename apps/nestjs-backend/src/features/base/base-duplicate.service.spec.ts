import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType, Relationship } from '@teable/core';
import { BaseDuplicateMode } from '@teable/openapi';
import { v2CoreTokens, type DuplicateBaseRecordReadOptions } from '@teable/v2-core';
import { GlobalModule } from '../../global/global.module';
import { BaseDuplicateService } from './base-duplicate.service';
import type { IBaseImportProgress } from './base-import.service';
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
  type IServiceArgs = ConstructorParameters<typeof BaseDuplicateService>;
  const duplicateBaseName = 'Duplicated base';
  const sourceTableName = 'Source table';
  const sourceDbTableName = 'bseSource.tblSource';

  type IDuplicateServiceInternals = {
    buildDuplicateStructureConfig: (...args: unknown[]) => Promise<unknown>;
    getCrossBaseLinkFieldTableMap: (...args: unknown[]) => Promise<ILinkFieldTableMap>;
    getDisconnectedLinkFieldTableMap: (...args: unknown[]) => Promise<ILinkFieldTableMap>;
    getV2CrossBaseLinkFieldTableMap: (...args: unknown[]) => Promise<ILinkFieldTableMap>;
    getV2DisconnectedLinkFieldTableMap: (...args: unknown[]) => Promise<ILinkFieldTableMap>;
    getV2InternalLinkRelationTableMap: (...args: unknown[]) => Promise<Record<string, unknown[]>>;
    getDisconnectedLinkFieldIds: (...args: unknown[]) => Promise<string[]>;
    normalizeDuplicateStructureForV2: (structure: unknown) => unknown;
    createDuplicateBaseSource: (...args: unknown[]) => {
      records(
        tableId: string,
        options?: DuplicateBaseRecordReadOptions
      ): AsyncIterable<{ fields: Record<string, unknown> }>;
    };
    duplicateTableData: (...args: unknown[]) => Promise<number>;
    duplicateAttachments: (...args: unknown[]) => Promise<void>;
    duplicateLinkJunction: (...args: unknown[]) => Promise<void>;
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
      v2ContainerService as unknown as IServiceArgs[9],
      v2ContextFactory as unknown as IServiceArgs[10],
      {} as IServiceArgs[11]
    );
    const internals = service as unknown as IDuplicateServiceInternals;

    const sourceDbTableNameByTableId = { tblSource: sourceDbTableName };

    vi.spyOn(internals, 'buildDuplicateStructureConfig').mockResolvedValue({
      structure,
      sourceDbTableNameByTableId,
    });
    vi.spyOn(internals, 'getV2CrossBaseLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getV2DisconnectedLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getV2InternalLinkRelationTableMap').mockResolvedValue({});
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
      sourceDbTableNameByTableId,
      {}
    );
    expect(commandBus.execute).toHaveBeenCalledWith(context, expect.any(Object));
  });

  it('should copy direct duplicate records through bulk SQL after v2 structure creation', async () => {
    const spaceId = 'spcTarget';
    const targetBaseId = 'bseTarget';
    const tableIdMap = { tblSource: 'tblTarget' };
    const targetTableId = tableIdMap.tblSource;
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
      dataDbClientManager as unknown as IServiceArgs[8],
      v2ContainerService as unknown as IServiceArgs[9],
      v2ContextFactory as unknown as IServiceArgs[10],
      {} as IServiceArgs[11]
    );
    const internals = service as unknown as IDuplicateServiceInternals;
    const mergedLinkFieldTableMap = {
      tblSource: [{ dbFieldName: 'fldLink', selfKeyName: '__id', isMultipleCellValue: true }],
    };

    vi.spyOn(internals, 'buildDuplicateStructureConfig').mockResolvedValue({
      structure,
      sourceDbTableNameByTableId: { tblSource: sourceDbTableName },
    });
    vi.spyOn(internals, 'getV2CrossBaseLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getV2DisconnectedLinkFieldTableMap').mockResolvedValue(
      mergedLinkFieldTableMap
    );
    vi.spyOn(internals, 'getV2InternalLinkRelationTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getDisconnectedLinkFieldIds').mockResolvedValue(['fldDisconnected']);
    vi.spyOn(internals, 'normalizeDuplicateStructureForV2').mockReturnValue(structure);
    vi.spyOn(internals, 'createDuplicateBaseSource').mockReturnValue(source);
    vi.spyOn(internals, 'duplicateTableData').mockResolvedValue(12);
    vi.spyOn(internals, 'duplicateAttachments').mockResolvedValue(undefined);
    vi.spyOn(internals, 'duplicateLinkJunction').mockResolvedValue(undefined);

    const result = await service.duplicateBaseV2({
      fromBaseId: 'bseSource',
      spaceId,
      name: duplicateBaseName,
      withRecords: true,
    });

    const executedCommand = commandBus.execute.mock.calls[0]?.[1] as {
      withRecords: boolean;
      batchSize: number;
    };
    expect(executedCommand.withRecords).toBe(false);
    expect(executedCommand.batchSize).toBe(500);
    expect(internals.duplicateTableData).toHaveBeenCalledWith(
      targetBaseId,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      mergedLinkFieldTableMap
    );
    expect(internals.duplicateLinkJunction).toHaveBeenCalledWith(
      targetBaseId,
      tableIdMap,
      fieldIdMap,
      true,
      ['fldDisconnected']
    );
    expect(persistedComputedBackfillService.recomputeForTables).toHaveBeenCalledWith([
      targetTableId,
    ]);
    expect(internals.duplicateAttachments).toHaveBeenCalledWith(
      targetBaseId,
      tableIdMap,
      fieldIdMap
    );
    expect(result.recordsLength).toBe(12);
  });

  it('should stream v2 duplicate records when source and target data databases differ', async () => {
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
            recordsLength: 7,
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
    const dataDbClientManager = {
      getDataDatabaseForBase: vi
        .fn()
        .mockResolvedValueOnce({ cacheKey: 'source-db' })
        .mockResolvedValueOnce({ cacheKey: 'target-db' }),
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
      {} as IServiceArgs[6],
      { get: vi.fn().mockReturnValue('usrTest') } as unknown as IServiceArgs[7],
      dataDbClientManager as unknown as IServiceArgs[8],
      v2ContainerService as unknown as IServiceArgs[9],
      v2ContextFactory as unknown as IServiceArgs[10],
      {} as IServiceArgs[11]
    );
    const internals = service as unknown as IDuplicateServiceInternals;

    vi.spyOn(internals, 'buildDuplicateStructureConfig').mockResolvedValue({
      structure,
      sourceDbTableNameByTableId: { tblSource: sourceDbTableName },
    });
    vi.spyOn(internals, 'getV2CrossBaseLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getV2DisconnectedLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getV2InternalLinkRelationTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getDisconnectedLinkFieldIds').mockResolvedValue([]);
    vi.spyOn(internals, 'normalizeDuplicateStructureForV2').mockReturnValue(structure);
    vi.spyOn(internals, 'createDuplicateBaseSource').mockReturnValue(source);
    vi.spyOn(internals, 'duplicateTableData').mockResolvedValue(0);
    vi.spyOn(internals, 'duplicateAttachments').mockResolvedValue(undefined);
    vi.spyOn(internals, 'duplicateLinkJunction').mockResolvedValue(undefined);

    const result = await service.duplicateBaseV2({
      fromBaseId: 'bseSource',
      spaceId,
      name: duplicateBaseName,
      withRecords: true,
    });

    expect(dataDbClientManager.getDataDatabaseForBase).toHaveBeenCalledWith('bseSource', {
      useTransaction: true,
    });
    expect(dataDbClientManager.getDataDatabaseForBase).toHaveBeenCalledWith(targetBaseId, {
      useTransaction: true,
    });
    expect((commandBus.execute.mock.calls[0]?.[1] as { withRecords: boolean }).withRecords).toBe(
      true
    );
    expect(internals.duplicateTableData).not.toHaveBeenCalled();
    expect(internals.duplicateLinkJunction).not.toHaveBeenCalled();
    expect(internals.duplicateAttachments).toHaveBeenCalledWith(
      targetBaseId,
      tableIdMap,
      fieldIdMap
    );
    expect(result.recordsLength).toBe(7);
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
            id: 'progress',
            phase: 'table_data_start',
            processedRows: 0,
            totalRows: 12,
          };
          yield {
            id: 'progress',
            phase: 'table_data_progress',
            tableId: 'tblTarget',
            tableName: sourceTableName,
            processedRows: 5,
            batchProcessedRows: 5,
            currentBatch: 1,
            totalRows: 12,
          };
          yield {
            id: 'progress',
            phase: 'table_data_done',
            processedRows: 12,
            totalRows: 12,
          };
          yield {
            id: 'done',
            baseId: targetBaseId,
            tableIdMap,
            fieldIdMap,
            viewIdMap,
            recordsLength: 12,
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
      dataDbClientManager as unknown as IServiceArgs[8],
      v2ContainerService as unknown as IServiceArgs[9],
      v2ContextFactory as unknown as IServiceArgs[10],
      {} as IServiceArgs[11]
    );
    const internals = service as unknown as IDuplicateServiceInternals;
    const progressEvents: unknown[] = [];

    vi.spyOn(internals, 'buildDuplicateStructureConfig').mockResolvedValue({
      structure,
      sourceDbTableNameByTableId: { tblSource: sourceDbTableName },
    });
    vi.spyOn(internals, 'getV2CrossBaseLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getV2DisconnectedLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getV2InternalLinkRelationTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'normalizeDuplicateStructureForV2').mockReturnValue(structure);
    vi.spyOn(internals, 'createDuplicateBaseSource').mockReturnValue(source);
    vi.spyOn(internals, 'duplicateTableData').mockResolvedValue(12);
    vi.spyOn(internals, 'duplicateAttachments').mockResolvedValue(undefined);
    vi.spyOn(internals, 'duplicateLinkJunction').mockResolvedValue(undefined);

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

    expect(internals.duplicateTableData).not.toHaveBeenCalled();
    expect((commandBus.execute.mock.calls[0]?.[1] as { withRecords: boolean }).withRecords).toBe(
      true
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
      {
        dataPrismaForBase: vi.fn().mockResolvedValue(dataPrisma),
      } as unknown as IServiceArgs[8],
      {} as IServiceArgs[9],
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
      {
        dataKnexForBase: vi.fn().mockResolvedValue(dataKnex),
      } as unknown as IServiceArgs[8],
      {} as IServiceArgs[9],
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
        lastModifiedTime: null,
        lastModifiedBy: null,
      },
    ]);
  });

  it('should skip internal v2 link relation reads during insert phase', async () => {
    const sourceTableQuery = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValueOnce([
          {
            __id: 'recSource',
            __auto_number: 1,
            fldStory: [{ id: 'recStale', title: 'Deleted story' }],
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const dataKnex = vi.fn((tableName: string) => {
      if (tableName === 'bseSource.tblSource') return sourceTableQuery;
      throw new Error(`unexpected table ${tableName}`);
    });
    const service = new BaseDuplicateService(
      {} as IServiceArgs[0],
      {} as IServiceArgs[1],
      {} as IServiceArgs[2],
      {} as IServiceArgs[3],
      {} as IServiceArgs[4],
      {} as IServiceArgs[5],
      {} as IServiceArgs[6],
      {} as IServiceArgs[7],
      { dataKnexForBase: vi.fn().mockResolvedValue(dataKnex) } as unknown as IServiceArgs[8],
      {} as IServiceArgs[9],
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
                id: 'fldStory',
                name: 'Story',
                dbFieldName: 'fldStory',
                type: FieldType.Link,
              },
            ],
            views: [],
          },
        ],
      },
      {},
      { tblSource: 'bseSource.tblSource' },
      {
        tblSource: [
          {
            fieldId: 'fldStory',
            dbFieldName: 'fldStory',
            foreignTableId: 'tblStory',
            lookupFieldId: 'fldStoryName',
            relationship: 'manyMany',
            fkHostTableName: 'bseSource.junction_fldStory',
            selfKeyName: '__fk_self',
            foreignKeyName: '__fk_foreign',
            isOneWay: false,
            isMultipleCellValue: true,
            orderColumnName: '__order',
          },
        ],
      }
    );

    const records = [];
    for await (const record of source.records('tblSource', { phase: 'insert' })) {
      records.push(record);
    }

    expect(dataKnex).toHaveBeenCalledWith('bseSource.tblSource');
    expect(dataKnex).not.toHaveBeenCalledWith('bseSource.junction_fldStory');
    expect(records[0].fields.fldStory).toEqual([{ id: 'recStale', title: 'Deleted story' }]);
  });

  it('should rebuild internal v2 link values from relation storage and ignore stale cache ids', async () => {
    const sourceTableQuery = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValueOnce([
          {
            __id: 'recSource',
            __auto_number: 1,
            fldStory: [
              { id: 'recExisting', title: 'Existing story' },
              { id: 'recStale', title: 'Deleted story' },
            ],
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const junctionQuery = {
      select: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        {
          sourceRecordId: 'recSource',
          foreignRecordId: 'recExisting',
        },
      ]),
    };
    const dataKnex = vi.fn((tableName: string) => {
      if (tableName === 'bseSource.tblSource') return sourceTableQuery;
      if (tableName === 'bseSource.junction_fldStory') return junctionQuery;
      throw new Error(`unexpected table ${tableName}`);
    });
    const service = new BaseDuplicateService(
      {} as IServiceArgs[0],
      {} as IServiceArgs[1],
      {} as IServiceArgs[2],
      {} as IServiceArgs[3],
      {} as IServiceArgs[4],
      {} as IServiceArgs[5],
      {} as IServiceArgs[6],
      {} as IServiceArgs[7],
      { dataKnexForBase: vi.fn().mockResolvedValue(dataKnex) } as unknown as IServiceArgs[8],
      {} as IServiceArgs[9],
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
                id: 'fldStory',
                name: 'Story',
                dbFieldName: 'fldStory',
                type: FieldType.Link,
              },
            ],
            views: [],
          },
        ],
      },
      {},
      { tblSource: 'bseSource.tblSource' },
      {
        tblSource: [
          {
            fieldId: 'fldStory',
            dbFieldName: 'fldStory',
            foreignTableId: 'tblStory',
            lookupFieldId: 'fldStoryName',
            relationship: 'manyMany',
            fkHostTableName: 'bseSource.junction_fldStory',
            selfKeyName: '__fk_self',
            foreignKeyName: '__fk_foreign',
            isOneWay: false,
            isMultipleCellValue: true,
            orderColumnName: '__order',
          },
        ],
      }
    );

    const records = [];
    for await (const record of source.records('tblSource', { phase: 'linkRestore' })) {
      records.push(record);
    }

    expect(dataKnex).toHaveBeenCalledWith('bseSource.tblSource');
    expect(dataKnex).toHaveBeenCalledWith('bseSource.junction_fldStory');
    expect(junctionQuery.whereIn).toHaveBeenCalledWith('__fk_self', ['recSource']);
    expect(records[0].fields.fldStory).toEqual([{ id: 'recExisting' }]);
  });

  it('should rebuild many-one internal v2 link values from current table FK storage', async () => {
    const sourceTableQuery = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValueOnce([
          {
            __id: 'recChild',
            __auto_number: 1,
            fldParent: { id: 'recStale', title: 'Deleted parent' },
          },
        ])
        .mockResolvedValueOnce([]),
      whereIn: vi.fn().mockReturnThis(),
      whereNotNull: vi.fn().mockResolvedValue([
        {
          sourceRecordId: 'recChild',
          foreignRecordId: 'recParent',
        },
      ]),
    };
    const dataKnex = vi.fn((tableName: string) => {
      if (tableName === 'bseSource.childTable') return sourceTableQuery;
      throw new Error(`unexpected table ${tableName}`);
    });
    const service = new BaseDuplicateService(
      {} as IServiceArgs[0],
      {} as IServiceArgs[1],
      {} as IServiceArgs[2],
      {} as IServiceArgs[3],
      {} as IServiceArgs[4],
      {} as IServiceArgs[5],
      {} as IServiceArgs[6],
      {} as IServiceArgs[7],
      { dataKnexForBase: vi.fn().mockResolvedValue(dataKnex) } as unknown as IServiceArgs[8],
      {} as IServiceArgs[9],
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
            id: 'tblChild',
            name: sourceTableName,
            dbTableName: 'childTable',
            fields: [
              {
                id: 'fldParent',
                name: 'Parent',
                dbFieldName: 'fldParent',
                type: FieldType.Link,
              },
            ],
            views: [],
          },
        ],
      },
      {},
      { tblChild: 'bseSource.childTable' },
      {
        tblChild: [
          {
            fieldId: 'fldParent',
            dbFieldName: 'fldParent',
            foreignTableId: 'tblParent',
            lookupFieldId: 'fldParentName',
            relationship: 'manyOne',
            fkHostTableName: 'bseSource.childTable',
            selfKeyName: '__id',
            foreignKeyName: '__fk_parent',
            isOneWay: false,
            isMultipleCellValue: false,
            orderColumnName: '__fk_parent_order',
          },
        ],
      }
    );

    const records = [];
    for await (const record of source.records('tblChild', { phase: 'linkRestore' })) {
      records.push(record);
    }

    expect(dataKnex).toHaveBeenCalledWith('bseSource.childTable');
    expect(sourceTableQuery.whereIn).toHaveBeenCalledWith('__id', ['recChild']);
    expect(sourceTableQuery.whereNotNull).toHaveBeenCalledWith('__fk_parent');
    expect(records[0].fields.fldParent).toEqual({ id: 'recParent' });
  });

  it('should rebuild two-way one-many internal v2 link values from foreign table FK storage', async () => {
    const sourceTableQuery = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValueOnce([
          {
            __id: 'recParent',
            __auto_number: 1,
            fldChildren: [
              { id: 'recChildExisting', title: 'Existing child' },
              { id: 'recChildStale', title: 'Deleted child' },
            ],
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const foreignTableQuery = {
      select: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        {
          sourceRecordId: 'recParent',
          foreignRecordId: 'recChildExisting',
        },
      ]),
    };
    const dataKnex = vi.fn((tableName: string) => {
      if (tableName === 'bseSource.parentTable') return sourceTableQuery;
      if (tableName === 'bseSource.childTable') return foreignTableQuery;
      throw new Error(`unexpected table ${tableName}`);
    });
    const service = new BaseDuplicateService(
      {} as IServiceArgs[0],
      {} as IServiceArgs[1],
      {} as IServiceArgs[2],
      {} as IServiceArgs[3],
      {} as IServiceArgs[4],
      {} as IServiceArgs[5],
      {} as IServiceArgs[6],
      {} as IServiceArgs[7],
      { dataKnexForBase: vi.fn().mockResolvedValue(dataKnex) } as unknown as IServiceArgs[8],
      {} as IServiceArgs[9],
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
            id: 'tblParent',
            name: sourceTableName,
            dbTableName: 'parentTable',
            fields: [
              {
                id: 'fldChildren',
                name: 'Children',
                dbFieldName: 'fldChildren',
                type: FieldType.Link,
              },
            ],
            views: [],
          },
        ],
      },
      {},
      { tblParent: 'bseSource.parentTable' },
      {
        tblParent: [
          {
            fieldId: 'fldChildren',
            dbFieldName: 'fldChildren',
            foreignTableId: 'tblChild',
            lookupFieldId: 'fldChildName',
            relationship: 'oneMany',
            fkHostTableName: 'bseSource.childTable',
            selfKeyName: '__fk_parent',
            foreignKeyName: '__id',
            isOneWay: false,
            isMultipleCellValue: true,
            orderColumnName: '__fk_parent_order',
          },
        ],
      }
    );

    const records = [];
    for await (const record of source.records('tblParent', { phase: 'linkRestore' })) {
      records.push(record);
    }

    expect(dataKnex).toHaveBeenCalledWith('bseSource.childTable');
    expect(foreignTableQuery.whereIn).toHaveBeenCalledWith('__fk_parent', ['recParent']);
    expect(foreignTableQuery.orderBy).toHaveBeenCalledWith('__fk_parent_order', 'asc');
    expect(records[0].fields.fldChildren).toEqual([{ id: 'recChildExisting' }]);
  });

  it('should normalize postgres array literal link values when downgrading v2 cross-base links', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValueOnce([
          {
            __id: 'recSource',
            __auto_number: 1,
            fldVendor: '{"{\\"id\\":\\"recVendor\\",\\"title\\":\\"Vendor A\\"}"}',
          },
        ])
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
      {
        dataKnexForBase: vi.fn().mockResolvedValue(dataKnex),
      } as unknown as IServiceArgs[8],
      {} as IServiceArgs[9],
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
            dbTableName: 'tblSource',
            fields: [
              {
                id: 'fldVendor',
                name: 'Vendor',
                dbFieldName: 'fldVendor',
                type: FieldType.SingleLineText,
              },
            ],
            views: [],
          },
        ],
      },
      {
        tblSource: [
          {
            dbFieldName: 'fldVendor',
            selfKeyName: 'fk_fld_vendor',
            isMultipleCellValue: true,
          },
        ],
      },
      { tblSource: 'bseSource.tblSource' }
    );

    const records = [];
    for await (const record of source.records('tblSource')) {
      records.push(record);
    }

    expect(records[0].fields.fldVendor).toBe('Vendor A');
  });

  it('should include nullable isLookup host link fields when building v2 cross-base maps', async () => {
    const fieldFindMany = vi.fn().mockResolvedValue([]);
    const service = new BaseDuplicateService(
      {
        txClient: vi.fn().mockReturnValue({
          field: { findMany: fieldFindMany },
        }),
      } as unknown as IServiceArgs[0],
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

    await internals.getV2CrossBaseLinkFieldTableMap({ tblSource: 'tblSource' });

    expect(fieldFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ isLookup: false }, { isLookup: null }],
        }),
      })
    );
  });
});
