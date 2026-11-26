import { PassThrough, Readable } from 'stream';
import { DbFieldType, FieldType, HttpErrorCode, Relationship, ViewType } from '@teable/core';
import { BaseDuplicateMode, type IBaseJson, type ImportBaseRo } from '@teable/openapi';
import type { RestoreRecordInput } from '@teable/v2-core';
import archiver from 'archiver';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { vi } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import { formatBaseImportError } from './base-import-contract';
import { BaseImportV2Service } from './base-import-v2.service';
import { BaseImportService } from './base-import.service';

interface IRestoreRecordInputBuilder {
  toRestoreRecordInput(
    row: Record<string, string>,
    config: {
      dbTableName: string;
      columnNames: Set<string>;
      fieldsByDbFieldName: Map<
        string,
        {
          id: string;
          type: string;
          dbFieldName: string;
          dbFieldType: string;
          isMultipleCellValue: boolean | null;
          isComputed: boolean | null;
          notNull: boolean | null;
        }
      >;
    },
    viewIdMap: Record<string, string>
  ): RestoreRecordInput;
}

interface IProcessStructureService {
  processStructure(
    zipStream: Readable,
    importBaseRo: Pick<ImportBaseRo, 'spaceId'> & Partial<Pick<ImportBaseRo, 'notify'>>,
    onProgress?: (...args: unknown[]) => void
  ): Promise<unknown>;
  createBaseStructure: ReturnType<typeof vi.fn>;
}

interface IPreviewImportBaseService {
  previewImportBase(importBaseRo: Pick<ImportBaseRo, 'spaceId' | 'notify'>): Promise<unknown>;
  storageAdapter: unknown;
}

interface IImportBaseV2Service {
  importBaseV2(
    importBaseRo: Pick<ImportBaseRo, 'spaceId' | 'notify'>,
    onProgress?: (...args: unknown[]) => void
  ): Promise<unknown>;
  storageAdapter: unknown;
  readDotTeaStructure: ReturnType<typeof vi.fn>;
  v2ContainerService: unknown;
  v2ContextFactory: unknown;
  createBaseV2: ReturnType<typeof vi.fn>;
  restoreBaseExtrasV2: ReturnType<typeof vi.fn>;
  importAttachmentsV2: ReturnType<typeof vi.fn>;
  importTableDataV2: ReturnType<typeof vi.fn>;
  importTableLinkFieldsV2: ReturnType<typeof vi.fn>;
  audit: unknown;
  computed: { recomputeForTables: ReturnType<typeof vi.fn> };
  cls: unknown;
}

const dbTableName = 'bse_test.tbl_test';
const jsonColumnName = 'json_col';
const textColumnName = 'text_col';
const textCellValue = 'plain text';
const importedBaseName = 'Imported base';

const createService = () =>
  Object.create(BaseImportV2Service.prototype) as IRestoreRecordInputBuilder;

const createZipStream = (structure: IBaseJson) => {
  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.append(JSON.stringify(structure), { name: 'structure.json' });
  void archive.finalize();
  return archive;
};

describe('BaseImportService', () => {
  const freezeError = new CustomHttpException(
    'Space data database migration is in progress',
    HttpErrorCode.CONFLICT,
    {
      errorCode: 'SPACE_DATA_DB_MIGRATING',
      migrationJobId: 'sdmjxxx',
    }
  );

  describe('formatBaseImportError', () => {
    it('falls back when an Error has an empty message', () => {
      expect(formatBaseImportError(new Error(''), 'Unknown import error')).toBe(
        'Unknown import error'
      );
    });

    it('uses domain error code and details when message is empty', () => {
      expect(
        formatBaseImportError(
          {
            code: 'dottea.parse_failed',
            message: '',
            details: { file: 'structure.json' },
            tags: ['unexpected'],
          },
          'Failed to import dottea structure'
        )
      ).toBe('Failed to import dottea structure: dottea.parse_failed - {"file":"structure.json"}');
    });

    it('uses network error code with a specific fallback when message is empty', () => {
      expect(
        formatBaseImportError({ code: 'ECONNREFUSED', message: '' }, 'Failed to connect data DB')
      ).toBe('Failed to connect data DB: ECONNREFUSED');
    });
  });

  describe('processStructure', () => {
    it('rejects import before downloading files or opening a transaction when the space is migrating', async () => {
      const service = Object.create(BaseImportService.prototype) as {
        importBase: BaseImportService['importBase'];
        importBaseV2: BaseImportV2Service['importBaseV2'];
        audit: { withOperation: ReturnType<typeof vi.fn> };
        cls: { get: ReturnType<typeof vi.fn> };
        spaceDataDbMigrationGuard: { assertSpaceWritable: ReturnType<typeof vi.fn> };
        storageAdapter: { downloadFile: ReturnType<typeof vi.fn> };
        prismaService: { $tx: ReturnType<typeof vi.fn> };
      };
      service.audit = {
        withOperation: vi.fn((_, fn: () => Promise<unknown>) => fn()),
      };
      service.cls = { get: vi.fn() };
      service.spaceDataDbMigrationGuard = {
        assertSpaceWritable: vi.fn().mockRejectedValue(freezeError),
      };
      service.storageAdapter = { downloadFile: vi.fn() };
      service.prismaService = { $tx: vi.fn() };
      const importRo = {
        spaceId: 'spcImport',
        notify: { path: 'imports/base.tea' },
      } as ImportBaseRo;
      const onProgress = vi.fn();

      await expect(service.importBase(importRo, onProgress)).rejects.toBe(freezeError);
      const nativeService = Object.assign(Object.create(BaseImportV2Service.prototype), service);
      await expect(nativeService.importBaseV2(importRo, onProgress)).rejects.toBe(freezeError);

      expect(service.spaceDataDbMigrationGuard.assertSpaceWritable).toHaveBeenCalledTimes(2);
      expect(service.spaceDataDbMigrationGuard.assertSpaceWritable).toHaveBeenCalledWith(
        'spcImport'
      );
      expect(onProgress).not.toHaveBeenCalled();
      expect(service.storageAdapter.downloadFile).not.toHaveBeenCalled();
      expect(service.prismaService.$tx).not.toHaveBeenCalled();
    });

    it('passes transaction-aware data DB routing into structure creation', async () => {
      const service = Object.create(BaseImportService.prototype) as IProcessStructureService;
      const structure = {
        id: 'bseSource',
        name: 'Source base',
        tables: [],
        plugins: {},
        folders: [],
        nodes: [],
      } as unknown as IBaseJson;
      const expectedResult = {
        base: { id: 'bseImported' },
        tableIdMap: {},
        fieldIdMap: {},
        viewIdMap: {},
        fkMap: {},
        structure,
      };

      service.createBaseStructure = vi.fn().mockResolvedValue(expectedResult);

      await expect(
        service.processStructure(createZipStream(structure), {
          spaceId: 'spcImport',
          notify: { path: 'imports/base.tea' },
        })
      ).resolves.toEqual({
        ...expectedResult,
        ignoredJunctionArchiveNames: [],
      });

      expect(service.createBaseStructure).toHaveBeenCalledWith(
        'spcImport',
        structure,
        undefined,
        undefined,
        undefined,
        undefined,
        { useTransaction: true },
        true
      );
    });

    it('rejects a hand-edited dbTableName before any structure is created', async () => {
      const service = Object.create(BaseImportService.prototype) as IProcessStructureService;
      const structure = {
        id: 'bseSource',
        name: 'Source base',
        tables: [
          {
            id: 'tblSource',
            name: 'Table',
            dbTableName: 'tbl"; DROP TABLE x; --',
            fields: [],
            views: [],
          },
        ],
        plugins: {},
        folders: [],
        nodes: [],
      } as unknown as IBaseJson;
      service.createBaseStructure = vi.fn();

      await expect(
        service.processStructure(createZipStream(structure), { spaceId: 'spcImport' })
      ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR });
      expect(service.createBaseStructure).not.toHaveBeenCalled();
    });

    it('rejects a hand-edited dbFieldName before any structure is created', async () => {
      const service = Object.create(BaseImportService.prototype) as IProcessStructureService;
      const structure = {
        id: 'bseSource',
        name: 'Source base',
        tables: [
          {
            id: 'tblSource',
            name: 'Table',
            dbTableName: 'tbl_source',
            fields: [
              {
                id: 'fldSource',
                name: 'Title',
                type: FieldType.SingleLineText,
                dbFieldName: 'title"; DROP TABLE x; --',
              },
            ],
            views: [],
          },
        ],
        plugins: {},
        folders: [],
        nodes: [],
      } as unknown as IBaseJson;
      service.createBaseStructure = vi.fn();

      await expect(
        service.processStructure(createZipStream(structure), { spaceId: 'spcImport' })
      ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR });
      expect(service.createBaseStructure).not.toHaveBeenCalled();
    });

    it.each([
      ['malformed JSON', '{ "name": "Broken", tables: oops }'],
      ['JSON cut off mid-way', '{ "name": "Broken", "tables": [{ "id": "tblA"'],
    ])(
      'rejects a structure.json holding %s as an invalid file before any structure is created',
      async (_case, json) => {
        const service = Object.create(BaseImportService.prototype) as IProcessStructureService;
        service.createBaseStructure = vi.fn();
        const archive = archiver('zip', { zlib: { level: 0 } });
        archive.append(json, { name: 'structure.json' });
        void archive.finalize();

        await expect(
          service.processStructure(archive, { spaceId: 'spcImport' })
        ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR });
        expect(service.createBaseStructure).not.toHaveBeenCalled();
        expect(archive.destroyed).toBe(true);
      }
    );

    it('rejects an archive without structure.json instead of waiting forever', async () => {
      const service = Object.create(BaseImportService.prototype) as IProcessStructureService;
      service.createBaseStructure = vi.fn();
      const archive = archiver('zip', { zlib: { level: 0 } });
      archive.append('id,name\n', { name: 'tables/tblA.csv' });
      void archive.finalize();

      await expect(
        service.processStructure(archive, { spaceId: 'spcImport' })
      ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR });
      expect(service.createBaseStructure).not.toHaveBeenCalled();
    }, 5_000);

    it('releases the structure stream once the structure is read', async () => {
      // structure.json is followed by table data that never finishes arriving.
      const service = Object.create(BaseImportService.prototype) as IProcessStructureService;
      const structure = {
        id: 'bseSource',
        name: 'Source base',
        tables: [],
      } as unknown as IBaseJson;
      service.createBaseStructure = vi.fn().mockResolvedValue({ base: { id: 'bseImported' } });
      const archive = archiver('zip', { zlib: { level: 0 } });
      archive.append(JSON.stringify(structure), { name: 'structure.json' });
      const endlessTableData = new PassThrough();
      endlessTableData.write('id,name\n');
      archive.append(endlessTableData, { name: 'tables/tblA.csv' });

      await expect(
        service.processStructure(archive, {
          spaceId: 'spcImport',
          notify: { path: 'imports/base.tea' },
        })
      ).resolves.toEqual({
        base: { id: 'bseImported' },
        structure,
        ignoredJunctionArchiveNames: [],
      });
      expect(archive.destroyed).toBe(true);
      endlessTableData.destroy();
    }, 5_000);

    it('creates imported base schemas through the space routed data client', async () => {
      const createdBase = {
        id: 'bseImported',
        name: importedBaseName,
        spaceId: 'spcImport',
        order: 1,
      };
      const baseCreate = vi.fn().mockResolvedValue(createdBase);
      const baseUpdate = vi.fn().mockResolvedValue({
        ...createdBase,
        name: importedBaseName,
      });
      const routedExecute = vi.fn().mockResolvedValue(0);
      const fallbackExecute = vi.fn().mockResolvedValue(0);
      const service = Object.create(BaseImportService.prototype) as {
        getMaxOrder: ReturnType<typeof vi.fn>;
        createBase: (
          spaceId: string,
          name: string,
          icon: string | undefined,
          routingOptions: { useTransaction: true }
        ) => Promise<unknown>;
        cls: unknown;
        prismaService: unknown;
        dbProvider: unknown;
        dataDbClientManager: {
          dataPrismaForSpace: ReturnType<typeof vi.fn>;
        };
        dataPrismaService: unknown;
      };

      service.getMaxOrder = vi.fn().mockResolvedValue(0);
      service.cls = { get: vi.fn().mockReturnValue('usrImport') };
      service.prismaService = {
        txClient: vi.fn().mockReturnValue({
          base: {
            create: baseCreate,
            update: baseUpdate,
          },
        }),
      };
      service.dbProvider = {
        createSchema: vi.fn().mockReturnValue(['CREATE SCHEMA "bseImported"']),
      };
      service.dataDbClientManager = {
        dataPrismaForSpace: vi.fn().mockResolvedValue({
          txClient: vi.fn().mockReturnValue({
            $executeRawUnsafe: routedExecute,
          }),
        }),
      };
      service.dataPrismaService = {
        $executeRawUnsafe: fallbackExecute,
      };

      await expect(
        service.createBase('spcImport', importedBaseName, 'icon', { useTransaction: true })
      ).resolves.toMatchObject({
        id: 'bseImported',
        name: importedBaseName,
      });

      expect(service.dataDbClientManager.dataPrismaForSpace).toHaveBeenCalledWith('spcImport', {
        useTransaction: true,
      });
      expect(routedExecute).toHaveBeenCalledWith('CREATE SCHEMA "bseImported"');
      expect(fallbackExecute).not.toHaveBeenCalled();
    });
  });

  describe('previewImportBase', () => {
    const previewRo = {
      spaceId: 'spcImport',
      notify: { path: 'import/preview.tea' },
    } as Pick<ImportBaseRo, 'spaceId' | 'notify'>;

    const createPreviewService = (zipStream: Readable) => {
      const service = Object.create(BaseImportV2Service.prototype) as IPreviewImportBaseService;
      service.storageAdapter = { downloadFile: vi.fn().mockResolvedValue(zipStream) };
      return service;
    };

    const previewStructure = {
      id: 'bseSource',
      name: 'Source base',
      tables: [
        { id: 'tblA', name: 'Orders', dbTableName: 'orders', fields: [], views: [] },
        { id: 'tblB', name: 'Customers', dbTableName: 'customers', fields: [], views: [] },
      ],
      plugins: { dashboard: [{ id: 'dsh1', name: 'Sales board' }], panel: [], view: [] },
      folders: [{ id: 'bnf1', name: 'Archive' }],
      nodes: [
        { id: 'bnoArchive', parentId: null, resourceId: 'bnf1', resourceType: 'folder', order: 2 },
        {
          id: 'bnoOrders',
          parentId: 'bnoArchive',
          resourceId: 'tblA',
          resourceType: 'table',
          order: 1,
        },
        { id: 'bnoBoard', parentId: null, resourceId: 'dsh1', resourceType: 'dashboard', order: 1 },
      ],
    } as unknown as IBaseJson;

    it('counts the nodes by type and lays them out in their folders', async () => {
      const zipStream = createZipStream(previewStructure);
      const service = createPreviewService(zipStream);

      await expect(service.previewImportBase(previewRo)).resolves.toEqual({
        name: 'Source base',
        groups: [
          { type: 'table', count: 2 },
          { type: 'dashboard', count: 1 },
          { type: 'folder', count: 1 },
        ],
        // Siblings follow their node order; Customers has no node and lands at the root.
        nodes: [
          { id: 'bnoOrders', parentId: 'bnoArchive', type: 'table', name: 'Orders' },
          { id: 'bnoBoard', parentId: null, type: 'dashboard', name: 'Sales board' },
          { id: 'bnoArchive', parentId: null, type: 'folder', name: 'Archive' },
          { id: 'table:tblB', parentId: null, type: 'table', name: 'Customers' },
        ],
      });
      expect(zipStream.destroyed).toBe(true);
    });

    it('stops reading once structure.json is parsed instead of draining the archive', async () => {
      // structure.json is followed by table data that never finishes arriving;
      // the preview must settle without waiting for the end of the archive.
      const archive = archiver('zip', { zlib: { level: 0 } });
      archive.append(JSON.stringify(previewStructure), { name: 'structure.json' });
      const endlessTableData = new PassThrough();
      endlessTableData.write('id,name\n');
      archive.append(endlessTableData, { name: 'tables/tblA.csv' });
      const service = createPreviewService(archive);

      await expect(service.previewImportBase(previewRo)).resolves.toMatchObject({
        name: 'Source base',
      });
      expect(archive.destroyed).toBe(true);
      endlessTableData.destroy();
    });

    it('treats a legacy structure without folders or plugins as having none', async () => {
      const structure = {
        id: 'bseSource',
        name: 'Legacy base',
        tables: [{ id: 'tblA', name: 'Orders', fields: [], views: [] }],
      } as unknown as IBaseJson;
      const service = createPreviewService(createZipStream(structure));

      await expect(service.previewImportBase(previewRo)).resolves.toEqual({
        name: 'Legacy base',
        groups: [{ type: 'table', count: 1 }],
        nodes: [{ id: 'table:tblA', parentId: null, type: 'table', name: 'Orders' }],
      });
    });

    it('moves nodes with a missing or cyclic parent to the root and skips unknown resources', async () => {
      const structure = {
        ...previewStructure,
        folders: [
          { id: 'bnf1', name: 'Loop A' },
          { id: 'bnf2', name: 'Loop B' },
        ],
        nodes: [
          { id: 'bnoA', parentId: 'bnoB', resourceId: 'bnf1', resourceType: 'folder', order: 1 },
          { id: 'bnoB', parentId: 'bnoA', resourceId: 'bnf2', resourceType: 'folder', order: 2 },
          {
            id: 'bnoOrders',
            parentId: 'bnoGone',
            resourceId: 'tblA',
            resourceType: 'table',
            order: 3,
          },
          { id: 'bnoFlow', parentId: null, resourceId: 'wflX', resourceType: 'workflow', order: 4 },
        ],
      } as unknown as IBaseJson;
      const service = createPreviewService(createZipStream(structure));

      const preview = (await service.previewImportBase(previewRo)) as {
        nodes: { id: string; parentId: string | null }[];
      };
      const parentOf = Object.fromEntries(preview.nodes.map((node) => [node.id, node.parentId]));

      // The import cannot place a folder inside itself; exactly one link of the loop is cut.
      expect([parentOf.bnoA, parentOf.bnoB].filter((parentId) => parentId === null)).toHaveLength(
        1
      );
      expect(parentOf.bnoOrders).toBeNull();
      expect(parentOf).not.toHaveProperty('bnoFlow');
    });

    it('reports a file that is not a zip archive as a validation error', async () => {
      const service = createPreviewService(Readable.from([Buffer.from('this is not a tea file')]));

      await expect(service.previewImportBase(previewRo)).rejects.toMatchObject({
        code: HttpErrorCode.VALIDATION_ERROR,
      });
    });

    it('reports an archive without structure.json as a validation error', async () => {
      const archive = archiver('zip', { zlib: { level: 0 } });
      archive.append('id,name\n', { name: 'tables/tblA.csv' });
      void archive.finalize();
      const service = createPreviewService(archive);

      await expect(service.previewImportBase(previewRo)).rejects.toMatchObject({
        code: HttpErrorCode.VALIDATION_ERROR,
      });
    });

    const createRawStructureZip = (structureJson: string, trailing?: Readable) => {
      const archive = archiver('zip', { zlib: { level: 0 } });
      archive.append(structureJson, { name: 'structure.json' });
      if (trailing) archive.append(trailing, { name: 'tables/tblA.csv' });
      else void archive.finalize();
      return archive;
    };

    it.each([
      ['malformed JSON', '{ "name": "Broken", tables: oops }'],
      ['JSON cut off mid-way', '{ "name": "Broken", "tables": [{ "id": "tblA"'],
      ['an empty file', ''],
    ])('reports a structure.json holding %s as a validation error', async (_case, json) => {
      const zipStream = createRawStructureZip(json);
      const service = createPreviewService(zipStream);

      const error = await service.previewImportBase(previewRo).then(
        () => undefined,
        (reason: { code?: string; message?: string }) => reason
      );

      expect(error?.code).toBe(HttpErrorCode.VALIDATION_ERROR);
      // The file has a structure.json; blaming a missing one would send the user the wrong way.
      expect(error?.message).not.toContain('not found');
      expect(zipStream.destroyed).toBe(true);
    });

    it('fails a malformed structure.json at once instead of waiting for the rest of the archive', async () => {
      // The broken structure.json is followed by table data that never finishes arriving.
      const endlessTableData = new PassThrough();
      endlessTableData.write('id,name\n');
      const zipStream = createRawStructureZip(
        '{ "name": "Broken", tables: oops }',
        endlessTableData
      );
      const service = createPreviewService(zipStream);

      await expect(service.previewImportBase(previewRo)).rejects.toMatchObject({
        code: HttpErrorCode.VALIDATION_ERROR,
      });
      expect(zipStream.destroyed).toBe(true);
      endlessTableData.destroy();
    }, 5_000);

    it('reports a hand-edited dbTableName the import would reject as a validation error', async () => {
      const structure = {
        ...previewStructure,
        tables: [{ id: 'tblA', name: 'Orders', dbTableName: 'tbl"; DROP TABLE x; --', fields: [] }],
      } as unknown as IBaseJson;
      const service = createPreviewService(createZipStream(structure));

      await expect(service.previewImportBase(previewRo)).rejects.toMatchObject({
        code: HttpErrorCode.VALIDATION_ERROR,
      });
    });

    it('keeps a storage failure distinct from an invalid file', async () => {
      const failingStream = new PassThrough();
      const service = createPreviewService(failingStream);
      const storageError = new Error('storage connection reset');

      const preview = service.previewImportBase(previewRo);
      setImmediate(() => failingStream.destroy(storageError));

      await expect(preview).rejects.toBe(storageError);
    });
  });

  describe('importBaseV2', () => {
    it('restores edition extras during dottea import and returns their id maps', async () => {
      const tableIdMap = { tblSource: 'tblImported' };
      const fieldIdMap = { fldSource: 'fldImported' };
      const viewIdMap = { viwSource: 'viwImported' };
      const appIdMap = { appSource: 'appImported' };
      const workflowIdMap = { wflSource: 'wflImported' };
      const commandBus = {
        execute: vi.fn().mockResolvedValue({
          isErr: () => false,
          value: {
            tableIdMap,
            fieldIdMap,
            viewIdMap,
          },
        }),
      };
      const queryBus = {};
      const tableRecordRepository = {};
      const unitOfWork = {};
      const db = {};
      const context = {};
      const container = {
        resolve: vi.fn((token: unknown) => {
          const tokenText = String(token);
          if (tokenText.includes('commandBus')) return commandBus;
          if (tokenText.includes('queryBus')) return queryBus;
          if (tokenText.includes('tableRecordRepository')) return tableRecordRepository;
          if (tokenText.includes('unitOfWork')) return unitOfWork;
          return db;
        }),
      };
      const structure = {
        id: 'bseSource',
        name: 'Source base',
        icon: 'icon',
        tables: [],
        plugins: {},
        folders: [],
        nodes: [],
      } as unknown as IBaseJson;
      const importedBase = { id: 'bseImported', name: 'Source base', spaceId: 'spcImport' };
      const service = Object.create(BaseImportV2Service.prototype) as IImportBaseV2Service;

      service.storageAdapter = {
        downloadFile: vi.fn().mockReturnValue({}),
      };
      service.readDotTeaStructure = vi.fn().mockResolvedValue(structure);
      service.v2ContainerService = {
        getContainerForSpace: vi.fn().mockResolvedValue(container),
      };
      service.v2ContextFactory = {
        createContext: vi.fn().mockResolvedValue(context),
      };
      service.createBaseV2 = vi.fn().mockResolvedValue(importedBase);
      service.restoreBaseExtrasV2 = vi.fn().mockResolvedValue({ appIdMap, workflowIdMap });
      Object.assign(service, { eventEmitter: { emitAsync: vi.fn().mockResolvedValue([]) } });
      service.importAttachmentsV2 = vi.fn().mockResolvedValue(undefined);
      service.importTableDataV2 = vi.fn().mockResolvedValue(false);
      service.importTableLinkFieldsV2 = vi.fn().mockResolvedValue(undefined);
      service.computed = { recomputeForTables: vi.fn().mockResolvedValue(undefined) };
      service.audit = {
        withOperation: vi.fn((_resolved, run: () => Promise<unknown>) => run()),
        current: () => ({ operationId: 'owned-import-operation' }),
      };
      service.cls = {
        get: vi.fn().mockReturnValue('usrImport'),
      };

      await expect(
        service.importBaseV2({
          spaceId: 'spcImport',
          notify: { path: 'import.tea' } as ImportBaseRo['notify'],
        })
      ).resolves.toMatchObject({
        base: importedBase,
        tableIdMap,
        fieldIdMap,
        viewIdMap,
        appIdMap,
        workflowIdMap,
        baseIdMap: { [structure.id]: importedBase.id },
      });

      expect(service.restoreBaseExtrasV2).toHaveBeenCalledWith(
        db,
        importedBase.id,
        structure,
        { tableIdMap, fieldIdMap, viewIdMap },
        BaseDuplicateMode.Normal,
        undefined,
        false,
        true
      );
      expect(commandBus.execute).toHaveBeenCalledTimes(1);
      expect(service.importTableDataV2).toHaveBeenCalledTimes(1);
      expect(service.importTableLinkFieldsV2).not.toHaveBeenCalled();
      expect(service.computed.recomputeForTables).not.toHaveBeenCalled();
    });

    it('rejects a hand-edited dbFieldName before touching the data database', async () => {
      const structure = {
        id: 'bseSource',
        name: 'Source base',
        tables: [
          {
            id: 'tblSource',
            name: 'Table',
            dbTableName: 'tbl_source',
            fields: [
              {
                id: 'fldSource',
                name: 'Title',
                type: FieldType.SingleLineText,
                dbFieldName: 'title"; DROP TABLE x; --',
              },
            ],
            views: [],
          },
        ],
        plugins: {},
        folders: [],
        nodes: [],
      } as unknown as IBaseJson;
      const getContainerForSpace = vi.fn();
      const service = Object.create(BaseImportV2Service.prototype) as IImportBaseV2Service;

      service.storageAdapter = {
        downloadFile: vi.fn().mockReturnValue({}),
      };
      service.readDotTeaStructure = vi.fn().mockResolvedValue(structure);
      service.v2ContainerService = { getContainerForSpace };
      service.createBaseV2 = vi.fn();
      service.audit = {
        withOperation: vi.fn((_resolved, run: () => Promise<unknown>) => run()),
      };
      service.cls = {
        get: vi.fn().mockReturnValue('usrImport'),
      };

      await expect(
        service.importBaseV2({
          spaceId: 'spcImport',
          notify: { path: 'import.tea' } as ImportBaseRo['notify'],
        })
      ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR });

      expect(getContainerForSpace).not.toHaveBeenCalled();
      expect(service.createBaseV2).not.toHaveBeenCalled();
    });

    it('emits computed_backfill_failed and includes base and table ids when computed backfill fails', async () => {
      const tableIdMap = { tblSource1: 'tblDest1' };
      const fieldIdMap = { fld1: 'fld2' };
      const viewIdMap = { viw1: 'viw2' };
      const commandBus = {
        execute: vi.fn().mockResolvedValue({
          isErr: () => false,
          value: {
            tableIdMap,
            fieldIdMap,
            viewIdMap,
          },
        }),
      };
      const db = {};
      const context = {};
      const container = {
        resolve: vi.fn((token: unknown) => {
          const tokenText = String(token);
          if (tokenText.includes('commandBus')) return commandBus;
          if (tokenText.includes('queryBus')) return {};
          if (tokenText.includes('tableRecordRepository')) return {};
          if (tokenText.includes('unitOfWork')) return {};
          return db;
        }),
      };
      const structure = {
        id: 'bseSource',
        name: 'Source base',
        icon: 'icon',
        tables: [{ id: 'tblSource1', name: 'Orders', fields: [], views: [] }],
        plugins: {},
        folders: [],
        nodes: [],
      } as unknown as IBaseJson;
      const importedBase = { id: 'bseImported', name: 'Source base', spaceId: 'spcImport' };
      const service = Object.create(BaseImportV2Service.prototype) as IImportBaseV2Service;

      service.storageAdapter = {
        downloadFile: vi.fn().mockReturnValue({}),
      };
      service.readDotTeaStructure = vi.fn().mockResolvedValue(structure);
      service.v2ContainerService = {
        getContainerForSpace: vi.fn().mockResolvedValue(container),
      };
      service.v2ContextFactory = {
        createContext: vi.fn().mockResolvedValue(context),
      };
      service.createBaseV2 = vi.fn().mockResolvedValue(importedBase);
      service.restoreBaseExtrasV2 = vi.fn().mockResolvedValue({});
      service.importAttachmentsV2 = vi.fn().mockResolvedValue(undefined);
      service.importTableDataV2 = vi.fn().mockResolvedValue(true);
      service.importTableLinkFieldsV2 = vi.fn().mockResolvedValue(undefined);
      service.computed = {
        recomputeForTables: vi.fn().mockRejectedValue(new Error('statement timeout')),
      };
      service.audit = {
        withOperation: vi.fn((_resolved, run: () => Promise<unknown>) => run()),
      };
      service.cls = {
        get: vi.fn().mockReturnValue('usrImport'),
      };
      const onProgress = vi.fn();

      let thrown: unknown;
      try {
        await service.importBaseV2(
          {
            spaceId: 'spcImport',
            notify: { path: 'import.tea' } as ImportBaseRo['notify'],
          },
          onProgress
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CustomHttpException);
      expect(thrown).toMatchObject({
        code: HttpErrorCode.INTERNAL_SERVER_ERROR,
        data: {
          baseId: 'bseImported',
          affectedTableIds: ['tblDest1'],
          affectedTables: [{ sourceTableId: 'tblSource1', tableId: 'tblDest1', name: 'Orders' }],
        },
      });
      expect((thrown as Error).message).toContain('bseImported');
      expect((thrown as Error).message).toContain('tblDest1');
      expect((thrown as Error).message).toContain('statement timeout');
      expect(onProgress).toHaveBeenCalledWith({
        phase: 'computed_backfill_failed',
        detail: expect.stringContaining('bseImported'),
      });
    });

    it('preserves webp thumbnail keys and content-type via parseImportAttachmentEntryName', async () => {
      const archive = archiver('zip', { zlib: { level: 0 } });
      archive.append(Buffer.from('webp-bytes'), {
        name: 'attachments/thumbnail__tok123_sm.webp.jpg',
      });
      archive.append(Buffer.from('bad-bytes'), {
        name: 'attachments/thumbnail__../../etc/passwd.png',
      });
      void archive.finalize();

      const uploadFileStream = vi.fn(
        (_bucket: string, _path: string, stream: Readable) =>
          new Promise<void>((resolve, reject) => {
            stream.once('end', resolve);
            stream.once('error', reject);
            stream.resume();
          })
      );
      const warn = vi.fn();
      const service = Object.create(BaseImportV2Service.prototype) as unknown as {
        storageAdapter: {
          downloadFile: ReturnType<typeof vi.fn>;
          uploadFileStream: typeof uploadFileStream;
        };
        logger: { warn: typeof warn };
        importAttachmentFilesV2(db: Kysely<unknown>, path: string): Promise<void>;
      };
      service.storageAdapter = {
        downloadFile: vi.fn().mockResolvedValue(archive),
        uploadFileStream,
      };
      service.logger = { warn };

      const db = new Kysely<unknown>({
        dialect: {
          createAdapter: () => new PostgresAdapter(),
          createDriver: () => new DummyDriver(),
          createIntrospector: (instance) => new PostgresIntrospector(instance),
          createQueryCompiler: () => new PostgresQueryCompiler(),
        },
      });

      await service.importAttachmentFilesV2(db, 'import.tea');

      expect(uploadFileStream).toHaveBeenCalledTimes(1);
      expect(uploadFileStream).toHaveBeenCalledWith(
        expect.any(String),
        'table/tok123_sm.webp',
        expect.anything(),
        {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'image/webp',
        }
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('thumbnail__../../etc/passwd.png'));
    });
  });

  describe('toRestoreRecordInput', () => {
    it.each([
      '__created_by_actor_type',
      '__created_by_actor_id',
      '__last_modified_by_actor_type',
      '__last_modified_by_actor_id',
    ])('never restores archive actor column %s, even with a colliding field', (column) => {
      const service = createService();
      const record = service.toRestoreRecordInput(
        { __id: 'recImported', [column]: 'forged' },
        {
          dbTableName,
          columnNames: new Set([column]),
          fieldsByDbFieldName: new Map([
            [
              column,
              {
                id: 'fldSpoof',
                type: FieldType.SingleLineText,
                dbFieldName: column,
                dbFieldType: DbFieldType.Text,
                isMultipleCellValue: false,
                isComputed: false,
                notNull: false,
              },
            ],
          ]),
        },
        {}
      );
      expect(record.fields).toEqual({});
      expect(record.extraColumnValues).toBeUndefined();
      expect(record).not.toHaveProperty('createdByActor');
    });

    it('serializes JSON extra column values for v2 dottea row restore', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set([jsonColumnName, textColumnName]),
        fieldsByDbFieldName: new Map([
          [
            jsonColumnName,
            {
              id: 'fldJsonValue',
              type: FieldType.MultipleSelect,
              dbFieldName: jsonColumnName,
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
          [
            textColumnName,
            {
              id: 'fldTextValue',
              type: FieldType.SingleLineText,
              dbFieldName: textColumnName,
              dbFieldType: DbFieldType.Text,
              isMultipleCellValue: false,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          [jsonColumnName]: '[{"id":"opt1","name":"A"}]',
          [textColumnName]: textCellValue,
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [jsonColumnName]: JSON.stringify([{ id: 'opt1', name: 'A' }]),
        [textColumnName]: textCellValue,
      });
    });

    it('wraps invalid legacy JSON cell strings before writing JSON columns', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set([jsonColumnName]),
        fieldsByDbFieldName: new Map([
          [
            jsonColumnName,
            {
              id: 'fldJsonValue',
              type: FieldType.MultipleSelect,
              dbFieldName: jsonColumnName,
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          [jsonColumnName]: 'legacy text',
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [jsonColumnName]: JSON.stringify('legacy text'),
      });
    });

    it('serializes lower-case JSON db field types', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set([jsonColumnName]),
        fieldsByDbFieldName: new Map([
          [
            jsonColumnName,
            {
              id: 'fldJsonValue',
              type: FieldType.MultipleSelect,
              dbFieldName: jsonColumnName,
              dbFieldType: 'json',
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          [jsonColumnName]: '[{"id":"opt1","name":"A"}]',
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [jsonColumnName]: JSON.stringify([{ id: 'opt1', name: 'A' }]),
      });
    });

    it('skips computed field types even when legacy dottea lacks isComputed', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set(['formula_col', textColumnName]),
        fieldsByDbFieldName: new Map([
          [
            'formula_col',
            {
              id: 'fldFormulaValue',
              type: FieldType.Formula,
              dbFieldName: 'formula_col',
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: null,
              notNull: false,
            },
          ],
          [
            textColumnName,
            {
              id: 'fldTextValue',
              type: FieldType.SingleLineText,
              dbFieldName: textColumnName,
              dbFieldType: DbFieldType.Text,
              isMultipleCellValue: false,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          formula_col: '[1]',
          [textColumnName]: textCellValue,
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [textColumnName]: textCellValue,
      });
      expect(record.extraColumnValues).not.toHaveProperty('formula_col');
    });

    it('keeps attachment values on the typed field path', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set(['attachment_col']),
        fieldsByDbFieldName: new Map([
          [
            'attachment_col',
            {
              id: 'fldAttachmentValue',
              type: FieldType.Attachment,
              dbFieldName: 'attachment_col',
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          attachment_col: '[{"id":"att1","name":"a.pdf"}]',
        },
        config,
        {}
      );

      expect(record.fields).toMatchObject({
        fldAttachmentValue: [{ id: 'att1', name: 'a.pdf' }],
      });
      expect(record.extraColumnValues).toBeUndefined();
    });
  });
});

describe('BaseImportV2Service dottea stream actor provenance', () => {
  it('routes actual CSV rows into import commands without trusting archive creator claims', async () => {
    const service = Object.create(BaseImportV2Service.prototype) as {
      importTableDataEntryV2: (...args: unknown[]) => Promise<void>;
    };
    const config = {
      dbTableName: 'base.table',
      columnNames: new Set([
        '__created_by_actor_type',
        '__created_by_actor_id',
        '__last_modified_by_actor_type',
        '__last_modified_by_actor_id',
      ]),
      fieldsByDbFieldName: new Map(),
    };
    Object.assign(service, {
      recordMutationPolicy: { assertAllowed: async () => undefined },
      buildTableDataImportConfig: async () => config,
      authorizeImportedUserValues: async (records: RestoreRecordInput[]) => ({
        records,
        relaxedRequiredUserFields: 0,
      }),
    });
    const csv = Readable.from([
      '__id,__created_by_actor_type,__created_by_actor_id,__last_modified_by_actor_type,__last_modified_by_actor_id\n',
      `rec${'a'.repeat(16)},user,forgedCreator,user,forgedModifier\n`,
      `rec${'b'.repeat(16)},appUser,forgedAppCreator,appUser,forgedAppModifier\n`,
    ]);
    const captured: RestoreRecordInput[] = [];
    const execute = vi.fn(
      async (
        _context,
        command: {
          records: AsyncIterable<RestoreRecordInput>;
          trustedCreatedActorsByRecordId?: unknown;
        }
      ) => {
        expect(command.trustedCreatedActorsByRecordId).toBeUndefined();
        for await (const record of command.records) captured.push(record);
        return {
          isErr: () => false,
          value: (async function* () {
            yield { id: 'done', restoredCount: captured.length };
          })(),
        };
      }
    );
    await service.importTableDataEntryV2(
      csv,
      { name: 'Imported' },
      'bseImport',
      `tbl${'t'.repeat(16)}`,
      {},
      { execute },
      {},
      {},
      {},
      {}
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(captured).toHaveLength(2);
    for (const record of captured) {
      expect(record.fields).toEqual({});
      expect(record.extraColumnValues).toBeUndefined();
      expect(record).not.toHaveProperty('createdByActorId');
    }
  });

  it('preserves empty [] on required multi-user fields without relaxing notNull or adding warnings', () => {
    const service = Object.create(BaseImportV2Service.prototype) as {
      parseImportedUserReferences: (
        rawValue: unknown,
        isMultiple: boolean
      ) => ReadonlyArray<{ id: string; email?: string }> | null;
      authorizeImportedUserCell: (
        references: ReadonlyArray<{ id: string; email?: string }> | null,
        field: { id: string; isMultipleCellValue: boolean; notNull: boolean },
        scopedUsersById: ReadonlyMap<string, unknown>,
        pairedUsersById: ReadonlyMap<string, unknown>,
        warnings: { skippedUserCells: number; relaxedRequiredUserFields: number },
        affectedRequiredFields: Set<string>
      ) => string | null;
    };

    const references = service.parseImportedUserReferences('[]', true);
    expect(references).toEqual([]);

    const warnings = { skippedUserCells: 0, relaxedRequiredUserFields: 0 };
    const affectedRequiredFields = new Set<string>();
    const authorized = service.authorizeImportedUserCell(
      references,
      { id: `fld${'u'.repeat(16)}`, isMultipleCellValue: true, notNull: true },
      new Map(),
      new Map(),
      warnings,
      affectedRequiredFields
    );

    expect(authorized).toBe('[]');
    expect(warnings.skippedUserCells).toBe(0);
    expect(affectedRequiredFields.size).toBe(0);
  });
});

describe('BaseImportService disconnected relation normalization', () => {
  it('downgrades links pointing outside the archive and their dependent lookups/rollups to singleLineText', () => {
    const service = Object.create(BaseImportService.prototype) as {
      normalizeDisconnectedImportTables: (tables: IBaseJson['tables']) => {
        tables: IBaseJson['tables'];
        ignoredJunctionArchiveNames: string[];
      };
    };

    const sourceTableId = `tbl${'a'.repeat(16)}`;
    const missingForeignTableId = `tbl${'z'.repeat(16)}`;
    const brokenLinkId = `fld${'l'.repeat(16)}`;
    const dependentLookupId = `fld${'k'.repeat(16)}`;
    const dependentRollupId = `fld${'r'.repeat(16)}`;

    const { tables: normalized, ignoredJunctionArchiveNames } =
      service.normalizeDisconnectedImportTables([
        {
          id: sourceTableId,
        name: 'Source',
        dbTableName: 'source',
        order: 1,
        views: [],
        fields: [
          {
            id: `fld${'p'.repeat(16)}`,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
          },
          {
            id: brokenLinkId,
            name: 'External Link',
            type: FieldType.Link,
            dbFieldName: 'External_Link',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: {
              relationship: 'manyMany',
              foreignTableId: missingForeignTableId,
              lookupFieldId: `fld${'x'.repeat(16)}`,
              fkHostTableName: 'junction_external_link',
              isOneWay: true,
            },
          },
          {
            id: dependentLookupId,
            name: 'External Lookup',
            type: FieldType.SingleLineText,
            isLookup: true,
            dbFieldName: 'External_Lookup',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            lookupOptions: {
              foreignTableId: missingForeignTableId,
              linkFieldId: brokenLinkId,
              lookupFieldId: `fld${'x'.repeat(16)}`,
            },
          },
          {
            id: dependentRollupId,
            name: 'External Rollup',
            type: FieldType.Rollup,
            dbFieldName: 'External_Rollup',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 4,
            createdTime: '2025-10-29T00:00:03.000Z',
            options: { expression: 'countall({values})' },
            lookupOptions: {
              foreignTableId: missingForeignTableId,
              linkFieldId: brokenLinkId,
              lookupFieldId: `fld${'x'.repeat(16)}`,
            },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
    ]);

    const fieldsById = new Map(normalized[0].fields.map((field) => [field.id, field]));
    expect(fieldsById.get(brokenLinkId)).toMatchObject({
      type: FieldType.SingleLineText,
      dbFieldType: DbFieldType.Text,
      cellValueType: 'string',
    });
    expect(fieldsById.get(brokenLinkId)?.options).toEqual({});
    expect(fieldsById.get(dependentLookupId)).toMatchObject({
      type: FieldType.SingleLineText,
      dbFieldType: DbFieldType.Text,
      cellValueType: 'string',
    });
    expect(fieldsById.get(dependentLookupId)?.isLookup).toBeUndefined();
    expect(fieldsById.get(dependentRollupId)).toMatchObject({
      type: FieldType.SingleLineText,
      dbFieldType: DbFieldType.Text,
      cellValueType: 'string',
    });
    expect(fieldsById.get(dependentRollupId)?.lookupOptions).toBeUndefined();
    expect(ignoredJunctionArchiveNames).toEqual(['junction_external_link']);
  });

  it('downgrades two-way self-links without symmetricFieldId, non-error rollups without lookupFieldId, and clears downgraded calendar bindings', () => {
    const service = Object.create(BaseImportService.prototype) as {
      normalizeDisconnectedImportTables: (tables: IBaseJson['tables']) => {
        tables: IBaseJson['tables'];
        ignoredJunctionArchiveNames: string[];
      };
    };

    const tableId = `tbl${'b'.repeat(16)}`;
    const selfLinkId = `fld${'s'.repeat(16)}`;
    const oneWayLinkId = `fld${'o'.repeat(16)}`;
    const rollupMissingLookupId = `fld${'m'.repeat(16)}`;
    const downgradedDateLookupId = `fld${'d'.repeat(16)}`;
    const validDateId = `fld${'v'.repeat(16)}`;

    const { tables: normalized, ignoredJunctionArchiveNames } =
      service.normalizeDisconnectedImportTables([
        {
          id: tableId,
          name: 'Events',
          dbTableName: 'events',
          order: 1,
          views: [
            {
              id: `viw${'c'.repeat(16)}`,
              name: 'Calendar',
              type: ViewType.Calendar,
              options: {
                startDateFieldId: downgradedDateLookupId,
                endDateFieldId: validDateId,
                titleFieldId: `fld${'p'.repeat(16)}`,
              },
            },
          ],
          fields: [
            {
              id: `fld${'p'.repeat(16)}`,
              name: 'Name',
              type: FieldType.SingleLineText,
              dbFieldName: 'Name',
              dbFieldType: DbFieldType.Text,
              cellValueType: 'string',
              isPrimary: true,
              order: 1,
              createdTime: '2025-10-29T00:00:00.000Z',
            },
            {
              id: validDateId,
              name: 'End Date',
              type: FieldType.Date,
              dbFieldName: 'End_Date',
              dbFieldType: DbFieldType.DateTime,
              cellValueType: 'dateTime',
              order: 2,
              createdTime: '2025-10-29T00:00:01.000Z',
            },
            {
              id: selfLinkId,
              name: 'Broken Two-Way Self Link',
              type: FieldType.Link,
              dbFieldName: 'Broken_Self_Link',
              dbFieldType: DbFieldType.Json,
              cellValueType: 'string',
              isMultipleCellValue: true,
              order: 3,
              createdTime: '2025-10-29T00:00:02.000Z',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableId,
                lookupFieldId: `fld${'p'.repeat(16)}`,
                fkHostTableName: 'junction_broken_self_link',
              },
            },
            {
              id: downgradedDateLookupId,
              name: 'Start Date Lookup',
              type: FieldType.Date,
              isLookup: true,
              dbFieldName: 'Start_Date_Lookup',
              dbFieldType: DbFieldType.DateTime,
              cellValueType: 'dateTime',
              order: 4,
              createdTime: '2025-10-29T00:00:03.000Z',
              lookupOptions: {
                foreignTableId: tableId,
                linkFieldId: selfLinkId,
                lookupFieldId: validDateId,
              },
            },
            {
              id: oneWayLinkId,
              name: 'Valid One-Way Self Link',
              type: FieldType.Link,
              dbFieldName: 'Valid_Self_Link',
              dbFieldType: DbFieldType.Json,
              cellValueType: 'string',
              isMultipleCellValue: true,
              order: 5,
              createdTime: '2025-10-29T00:00:04.000Z',
              options: {
                relationship: 'manyOne',
                foreignTableId: tableId,
                lookupFieldId: `fld${'p'.repeat(16)}`,
                isOneWay: true,
              },
            },
            {
              id: rollupMissingLookupId,
              name: 'Rollup Missing Target',
              type: FieldType.Rollup,
              dbFieldName: 'Rollup_Missing_Target',
              dbFieldType: DbFieldType.Real,
              cellValueType: 'number',
              order: 6,
              createdTime: '2025-10-29T00:00:05.000Z',
              options: { expression: 'countall({values})' },
              lookupOptions: {
                foreignTableId: tableId,
                linkFieldId: oneWayLinkId,
              },
            },
          ],
        } as unknown as IBaseJson['tables'][number],
      ]);

    const fieldsById = new Map(normalized[0].fields.map((field) => [field.id, field]));
    expect(fieldsById.get(selfLinkId)?.type).toBe(FieldType.SingleLineText);
    expect(fieldsById.get(downgradedDateLookupId)?.type).toBe(FieldType.SingleLineText);
    expect(fieldsById.get(downgradedDateLookupId)?.isLookup).toBeUndefined();
    expect(fieldsById.get(oneWayLinkId)?.type).toBe(FieldType.Link);
    expect(fieldsById.get(rollupMissingLookupId)?.type).toBe(FieldType.SingleLineText);
    expect(ignoredJunctionArchiveNames).toEqual(['junction_broken_self_link']);
    expect(normalized[0].views[0].options).toEqual({
      endDateFieldId: validDateId,
      titleFieldId: `fld${'p'.repeat(16)}`,
    });
  });

  it('downgrades incompatible downstream fields while preserving text-compatible consumers across downgraded and errored computed targets', () => {
    const service = Object.create(BaseImportService.prototype) as {
      normalizeDisconnectedImportTables: (tables: IBaseJson['tables']) => {
        tables: IBaseJson['tables'];
        ignoredJunctionArchiveNames: string[];
      };
    };

    const downstreamTableId = `tbl${'c'.repeat(16)}`;
    const upstreamTableId = `tbl${'d'.repeat(16)}`;
    const validLinkId = `fld${'l'.repeat(16)}`;
    const downstreamSumRollupId = `fld${'r'.repeat(16)}`;
    const downstreamCountRollupId = `fld${'m'.repeat(16)}`;
    const downstreamTextLookupId = `fld${'t'.repeat(16)}`;
    const downstreamConditionalLookupId = `fld${'k'.repeat(16)}`;
    const downstreamSumOfErroredRollupId = `fld${'e'.repeat(16)}`;
    const downstreamCountOfErroredRollupId = `fld${'f'.repeat(16)}`;
    const downstreamNumberLookupOfErroredId = `fld${'g'.repeat(16)}`;
    const upstreamBrokenLinkId = `fld${'x'.repeat(16)}`;
    const upstreamNumberLookupId = `fld${'n'.repeat(16)}`;
    const upstreamErroredNumberLookupId = `fld${'h'.repeat(16)}`;
    const upstreamNumberFieldId = `fld${'u'.repeat(16)}`;

    const { tables: normalized } = service.normalizeDisconnectedImportTables([
      {
        id: downstreamTableId,
        name: 'Summary',
        dbTableName: 'summary',
        order: 1,
        views: [],
        fields: [
          {
            id: `fld${'a'.repeat(16)}`,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
          },
          {
            id: validLinkId,
            name: 'Upstream',
            type: FieldType.Link,
            dbFieldName: 'Upstream',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: {
              relationship: 'manyOne',
              foreignTableId: upstreamTableId,
              lookupFieldId: `fld${'b'.repeat(16)}`,
              isOneWay: true,
            },
          },
          {
            id: downstreamSumRollupId,
            name: 'Sum Of Downgraded Lookup',
            type: FieldType.Rollup,
            dbFieldName: 'Sum_Of_Downgraded_Lookup',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            options: { expression: 'sum({values})' },
            lookupOptions: {
              foreignTableId: upstreamTableId,
              linkFieldId: validLinkId,
              lookupFieldId: upstreamNumberLookupId,
            },
          },
          {
            id: downstreamCountRollupId,
            name: 'Count Of Downgraded Lookup',
            type: FieldType.Rollup,
            dbFieldName: 'Count_Of_Downgraded_Lookup',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 4,
            createdTime: '2025-10-29T00:00:03.000Z',
            options: { expression: 'countall({values})' },
            lookupOptions: {
              foreignTableId: upstreamTableId,
              linkFieldId: validLinkId,
              lookupFieldId: upstreamNumberLookupId,
            },
          },
          {
            id: downstreamTextLookupId,
            name: 'Text Lookup Of Downgraded',
            type: FieldType.SingleLineText,
            isLookup: true,
            dbFieldName: 'Text_Lookup_Of_Downgraded',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 5,
            createdTime: '2025-10-29T00:00:04.000Z',
            lookupOptions: {
              foreignTableId: upstreamTableId,
              linkFieldId: validLinkId,
              lookupFieldId: upstreamNumberLookupId,
            },
          },
          {
            id: downstreamConditionalLookupId,
            name: 'Conditional Number Lookup',
            type: FieldType.Number,
            isLookup: true,
            isConditionalLookup: true,
            dbFieldName: 'Conditional_Number_Lookup',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'number',
            isMultipleCellValue: true,
            order: 6,
            createdTime: '2025-10-29T00:00:05.000Z',
            lookupOptions: {
              foreignTableId: upstreamTableId,
              lookupFieldId: upstreamNumberLookupId,
            },
          },
          {
            id: downstreamSumOfErroredRollupId,
            name: 'Sum Of Errored Lookup',
            type: FieldType.Rollup,
            dbFieldName: 'Sum_Of_Errored_Lookup',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 7,
            createdTime: '2025-10-29T00:00:06.000Z',
            options: { expression: 'sum({values})' },
            lookupOptions: {
              foreignTableId: upstreamTableId,
              linkFieldId: validLinkId,
              lookupFieldId: upstreamErroredNumberLookupId,
            },
          },
          {
            id: downstreamCountOfErroredRollupId,
            name: 'Count Of Errored Lookup',
            type: FieldType.Rollup,
            dbFieldName: 'Count_Of_Errored_Lookup',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 8,
            createdTime: '2025-10-29T00:00:07.000Z',
            options: { expression: 'countall({values})' },
            lookupOptions: {
              foreignTableId: upstreamTableId,
              linkFieldId: validLinkId,
              lookupFieldId: upstreamErroredNumberLookupId,
            },
          },
          {
            id: downstreamNumberLookupOfErroredId,
            name: 'Number Lookup Of Errored',
            type: FieldType.Number,
            isLookup: true,
            dbFieldName: 'Number_Lookup_Of_Errored',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'number',
            isMultipleCellValue: true,
            order: 9,
            createdTime: '2025-10-29T00:00:08.000Z',
            lookupOptions: {
              foreignTableId: upstreamTableId,
              linkFieldId: validLinkId,
              lookupFieldId: upstreamErroredNumberLookupId,
            },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
      {
        id: upstreamTableId,
        name: 'Source',
        dbTableName: 'source',
        order: 2,
        views: [],
        fields: [
          {
            id: `fld${'b'.repeat(16)}`,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
          },
          {
            id: upstreamNumberFieldId,
            name: 'Amount',
            type: FieldType.Number,
            dbFieldName: 'Amount',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
          },
          {
            id: upstreamBrokenLinkId,
            name: 'Broken Two-Way Link',
            type: FieldType.Link,
            dbFieldName: 'Broken_Two_Way_Link',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            options: {
              relationship: 'manyMany',
              foreignTableId: upstreamTableId,
              lookupFieldId: `fld${'b'.repeat(16)}`,
            },
          },
          {
            id: upstreamNumberLookupId,
            name: 'Amount Lookup',
            type: FieldType.Number,
            isLookup: true,
            dbFieldName: 'Amount_Lookup',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'number',
            isMultipleCellValue: true,
            order: 4,
            createdTime: '2025-10-29T00:00:03.000Z',
            lookupOptions: {
              foreignTableId: upstreamTableId,
              linkFieldId: upstreamBrokenLinkId,
              lookupFieldId: upstreamNumberFieldId,
            },
          },
          {
            id: upstreamErroredNumberLookupId,
            name: 'Errored Amount Lookup',
            type: FieldType.Number,
            isLookup: true,
            hasError: true,
            dbFieldName: 'Errored_Amount_Lookup',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'number',
            isMultipleCellValue: true,
            order: 5,
            createdTime: '2025-10-29T00:00:04.000Z',
            lookupOptions: {
              foreignTableId: upstreamTableId,
              linkFieldId: validLinkId,
              lookupFieldId: `fld${'z'.repeat(16)}`,
            },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
    ]);

    const downstreamFields = new Map(normalized[0].fields.map((field) => [field.id, field]));
    const upstreamFields = new Map(normalized[1].fields.map((field) => [field.id, field]));
    expect(upstreamFields.get(upstreamBrokenLinkId)?.type).toBe(FieldType.SingleLineText);
    expect(upstreamFields.get(upstreamNumberLookupId)?.type).toBe(FieldType.SingleLineText);
    expect(upstreamFields.get(upstreamErroredNumberLookupId)?.type).toBe(FieldType.SingleLineText);
    expect(upstreamFields.get(upstreamErroredNumberLookupId)?.isLookup).toBeUndefined();
    expect(upstreamFields.get(upstreamErroredNumberLookupId)?.hasError).toBeUndefined();
    expect(downstreamFields.get(validLinkId)?.type).toBe(FieldType.Link);
    expect(downstreamFields.get(downstreamSumRollupId)?.type).toBe(FieldType.SingleLineText);
    expect(downstreamFields.get(downstreamSumRollupId)?.lookupOptions).toBeUndefined();
    expect(downstreamFields.get(downstreamCountRollupId)?.type).toBe(FieldType.Rollup);
    expect(downstreamFields.get(downstreamTextLookupId)?.type).toBe(FieldType.SingleLineText);
    expect(downstreamFields.get(downstreamTextLookupId)?.isLookup).toBe(true);
    expect(downstreamFields.get(downstreamConditionalLookupId)?.type).toBe(
      FieldType.SingleLineText
    );
    expect(downstreamFields.get(downstreamConditionalLookupId)?.isLookup).toBeUndefined();
    expect(downstreamFields.get(downstreamSumOfErroredRollupId)?.type).toBe(
      FieldType.SingleLineText
    );
    expect(downstreamFields.get(downstreamCountOfErroredRollupId)?.type).toBe(FieldType.Rollup);
    expect(downstreamFields.get(downstreamNumberLookupOfErroredId)?.type).toBe(
      FieldType.SingleLineText
    );
    expect(downstreamFields.get(downstreamNumberLookupOfErroredId)?.isLookup).toBeUndefined();
  });

  it('preserves CSV values for errored rollups and rollups whose targets lose type or formula array shape', () => {
    const service = Object.create(BaseImportService.prototype) as INormalizeDisconnectedService;
    const sourceTableId = `tbl${'1'.repeat(16)}`;
    const midTableId = `tbl${'2'.repeat(16)}`;
    const consumerTableId = `tbl${'3'.repeat(16)}`;
    const brokenLinkId = `fld${'a'.repeat(16)}`;
    const downgradedNumberLookupId = `fld${'b'.repeat(16)}`;
    const erroredRollupId = `fld${'c'.repeat(16)}`;
    const erroredConditionalRollupId = `fld${'d'.repeat(16)}`;
    const midToSourceLinkId = `fld${'e'.repeat(16)}`;
    const numericArrayUniqueId = `fld${'f'.repeat(16)}`;
    const stringArrayUniqueId = `fld${'g'.repeat(16)}`;
    const consumerToMidLinkId = `fld${'h'.repeat(16)}`;
    const consumerSumOfArrayUniqueId = `fld${'i'.repeat(16)}`;
    const splitFormulaId = `fld${'j'.repeat(16)}`;
    const scalarFormulaId = `fld${'k'.repeat(16)}`;
    const splitArrayUniqueId = `fld${'l'.repeat(16)}`;
    const splitConditionalArrayCompactId = `fld${'m'.repeat(16)}`;
    const scalarArrayUniqueId = `fld${'n'.repeat(16)}`;

    const { tables: normalized } = service.normalizeDisconnectedImportTables([
      {
        id: sourceTableId,
        name: 'Source',
        dbTableName: 'source',
        order: 1,
        views: [],
        fields: [
          {
            id: `fld${'0'.repeat(16)}`,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
          },
          {
            id: brokenLinkId,
            name: 'Broken Link',
            type: FieldType.Link,
            dbFieldName: 'Broken_Link',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: {
              relationship: 'manyMany',
              foreignTableId: `tbl${'x'.repeat(16)}`,
              lookupFieldId: `fld${'y'.repeat(16)}`,
              isOneWay: true,
            },
          },
          {
            id: downgradedNumberLookupId,
            name: 'Number Lookup',
            type: FieldType.Number,
            isLookup: true,
            dbFieldName: 'Number_Lookup',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'number',
            isMultipleCellValue: true,
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            lookupOptions: {
              foreignTableId: `tbl${'x'.repeat(16)}`,
              linkFieldId: brokenLinkId,
              lookupFieldId: `fld${'z'.repeat(16)}`,
            },
          },
          {
            id: erroredRollupId,
            name: 'Errored Rollup',
            type: FieldType.Rollup,
            hasError: true,
            dbFieldName: 'Errored_Rollup',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 4,
            createdTime: '2025-10-29T00:00:03.000Z',
            options: { expression: 'sum({values})' },
            lookupOptions: {
              foreignTableId: sourceTableId,
              linkFieldId: midToSourceLinkId,
              lookupFieldId: `fld${'0'.repeat(16)}`,
            },
          },
          {
            id: erroredConditionalRollupId,
            name: 'Errored Conditional Rollup',
            type: FieldType.ConditionalRollup,
            hasError: true,
            dbFieldName: 'Errored_Conditional_Rollup',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 5,
            createdTime: '2025-10-29T00:00:04.000Z',
            options: {
              foreignTableId: sourceTableId,
              lookupFieldId: `fld${'0'.repeat(16)}`,
              expression: 'sum({values})',
            },
          },
          {
            id: splitFormulaId,
            name: 'Split Formula',
            type: FieldType.Formula,
            dbFieldName: 'Split_Formula',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 6,
            createdTime: '2025-10-29T00:00:05.000Z',
            options: { expression: `TEXTSPLIT(CONCATENATE({${brokenLinkId}}), ", ")` },
          },
          {
            id: scalarFormulaId,
            name: 'Scalar Formula',
            type: FieldType.Formula,
            dbFieldName: 'Scalar_Formula',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            order: 7,
            createdTime: '2025-10-29T00:00:06.000Z',
            options: { expression: `CONCATENATE({${brokenLinkId}})` },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
      {
        id: midTableId,
        name: 'Mid',
        dbTableName: 'mid',
        order: 2,
        views: [],
        fields: [
          {
            id: `fld${'1'.repeat(16)}`,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
          },
          {
            id: midToSourceLinkId,
            name: 'Source Link',
            type: FieldType.Link,
            dbFieldName: 'Source_Link',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: {
              relationship: 'manyMany',
              foreignTableId: sourceTableId,
              lookupFieldId: `fld${'0'.repeat(16)}`,
              isOneWay: true,
            },
          },
          {
            id: numericArrayUniqueId,
            name: 'Numeric Array Unique',
            type: FieldType.Rollup,
            dbFieldName: 'Numeric_Array_Unique',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'number',
            isMultipleCellValue: true,
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            options: {
              expression: 'array_unique({values})',
              formatting: { type: 'decimal', precision: 2 },
            },
            lookupOptions: {
              foreignTableId: sourceTableId,
              linkFieldId: midToSourceLinkId,
              lookupFieldId: downgradedNumberLookupId,
            },
          },
          {
            id: stringArrayUniqueId,
            name: 'String Array Unique',
            type: FieldType.Rollup,
            dbFieldName: 'String_Array_Unique',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 4,
            createdTime: '2025-10-29T00:00:03.000Z',
            options: {
              expression: 'array_unique({values})',
            },
            lookupOptions: {
              foreignTableId: sourceTableId,
              linkFieldId: midToSourceLinkId,
              lookupFieldId: brokenLinkId,
            },
          },
          {
            id: splitArrayUniqueId,
            name: 'Split Formula Array Unique',
            type: FieldType.Rollup,
            dbFieldName: 'Split_Formula_Array_Unique',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 5,
            createdTime: '2025-10-29T00:00:04.000Z',
            options: { expression: 'array_unique({values})' },
            lookupOptions: {
              foreignTableId: sourceTableId,
              linkFieldId: midToSourceLinkId,
              lookupFieldId: splitFormulaId,
            },
          },
          {
            id: splitConditionalArrayCompactId,
            name: 'Split Formula Conditional Array Compact',
            type: FieldType.ConditionalRollup,
            dbFieldName: 'Split_Formula_Conditional_Array_Compact',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 6,
            createdTime: '2025-10-29T00:00:05.000Z',
            options: {
              foreignTableId: sourceTableId,
              lookupFieldId: splitFormulaId,
              expression: 'array_compact({values})',
            },
          },
          {
            id: scalarArrayUniqueId,
            name: 'Scalar Formula Array Unique',
            type: FieldType.Rollup,
            dbFieldName: 'Scalar_Formula_Array_Unique',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 7,
            createdTime: '2025-10-29T00:00:06.000Z',
            options: { expression: 'array_unique({values})' },
            lookupOptions: {
              foreignTableId: sourceTableId,
              linkFieldId: midToSourceLinkId,
              lookupFieldId: scalarFormulaId,
            },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
      {
        id: consumerTableId,
        name: 'Consumer',
        dbTableName: 'consumer',
        order: 3,
        views: [],
        fields: [
          {
            id: `fld${'2'.repeat(16)}`,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
          },
          {
            id: consumerToMidLinkId,
            name: 'Mid Link',
            type: FieldType.Link,
            dbFieldName: 'Mid_Link',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: {
              relationship: 'manyMany',
              foreignTableId: midTableId,
              lookupFieldId: `fld${'1'.repeat(16)}`,
              isOneWay: true,
            },
          },
          {
            id: consumerSumOfArrayUniqueId,
            name: 'Sum Of Array Unique',
            type: FieldType.Rollup,
            dbFieldName: 'Sum_Of_Array_Unique',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            options: {
              expression: 'sum({values})',
            },
            lookupOptions: {
              foreignTableId: midTableId,
              linkFieldId: consumerToMidLinkId,
              lookupFieldId: numericArrayUniqueId,
            },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
    ]);

    const sourceFields = new Map(normalized[0].fields.map((field) => [field.id, field]));
    const midFields = new Map(normalized[1].fields.map((field) => [field.id, field]));
    const consumerFields = new Map(normalized[2].fields.map((field) => [field.id, field]));

    expect(sourceFields.get(erroredRollupId)?.type).toBe(FieldType.SingleLineText);
    expect(sourceFields.get(erroredRollupId)?.hasError).toBeUndefined();
    expect(sourceFields.get(erroredConditionalRollupId)?.type).toBe(FieldType.SingleLineText);
    expect(sourceFields.get(erroredConditionalRollupId)?.hasError).toBeUndefined();
    expect(midFields.get(numericArrayUniqueId)?.type).toBe(FieldType.SingleLineText);
    expect(midFields.get(numericArrayUniqueId)?.options).toEqual({});
    expect(midFields.get(stringArrayUniqueId)?.type).toBe(FieldType.Rollup);
    expect(sourceFields.get(splitFormulaId)?.type).toBe(FieldType.SingleLineText);
    expect(sourceFields.get(splitFormulaId)?.isMultipleCellValue).toBeUndefined();
    expect(sourceFields.get(scalarFormulaId)?.type).toBe(FieldType.SingleLineText);
    expect(midFields.get(splitArrayUniqueId)?.type).toBe(FieldType.SingleLineText);
    expect(midFields.get(splitArrayUniqueId)?.lookupOptions).toBeUndefined();
    expect(midFields.get(splitConditionalArrayCompactId)?.type).toBe(FieldType.SingleLineText);
    expect(midFields.get(splitConditionalArrayCompactId)?.options).toEqual({});
    expect(midFields.get(scalarArrayUniqueId)?.type).toBe(FieldType.Rollup);
    expect(consumerFields.get(consumerSumOfArrayUniqueId)?.type).toBe(FieldType.SingleLineText);
  });

  it('downgrades conditional fields whose filter predicates become incompatible after field downgrade while preserving valid filters', () => {
    const service = Object.create(BaseImportService.prototype) as {
      normalizeDisconnectedImportTables: (tables: IBaseJson['tables']) => {
        tables: IBaseJson['tables'];
        ignoredJunctionArchiveNames: string[];
      };
    };

    const sourceTableId = `tbl${'d'.repeat(16)}`;
    const hostTableId = `tbl${'e'.repeat(16)}`;
    const missingTableId = `tbl${'f'.repeat(16)}`;
    const sourceTitleId = `fld${'0'.repeat(16)}`;
    const sourceBrokenLinkId = `fld${'a'.repeat(16)}`;
    const sourceDowngradedNumLookupId = `fld${'b'.repeat(16)}`;
    const sourceDowngradedTextLookupId = `fld${'c'.repeat(16)}`;
    const sourceHealthyNumberId = `fld${'d'.repeat(16)}`;
    const hostBrokenLinkId = `fld${'e'.repeat(16)}`;
    const hostDowngradedNumLookupId = `fld${'f'.repeat(16)}`;
    const condRollupInvalidLhsId = `fld${'g'.repeat(16)}`;
    const condLookupInvalidLhsId = `fld${'h'.repeat(16)}`;
    const condRollupInvalidRhsId = `fld${'i'.repeat(16)}`;
    const condRollupValidTextFilterId = `fld${'j'.repeat(16)}`;

    const { tables: normalized } = service.normalizeDisconnectedImportTables([
      {
        id: sourceTableId,
        name: 'Source',
        dbTableName: 'source',
        order: 1,
        views: [],
        fields: [
          {
            id: sourceTitleId,
            name: 'Title',
            type: FieldType.SingleLineText,
            dbFieldName: 'Title',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
          },
          {
            id: sourceBrokenLinkId,
            name: 'Missing Link',
            type: FieldType.Link,
            dbFieldName: 'Missing_Link',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: {
              relationship: 'manyOne',
              foreignTableId: missingTableId,
              lookupFieldId: `fld${'9'.repeat(16)}`,
              isOneWay: true,
            },
          },
          {
            id: sourceDowngradedNumLookupId,
            name: 'Score Lookup',
            type: FieldType.Number,
            isLookup: true,
            dbFieldName: 'Score_Lookup',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            options: {},
            lookupOptions: {
              foreignTableId: missingTableId,
              linkFieldId: sourceBrokenLinkId,
              lookupFieldId: `fld${'8'.repeat(16)}`,
            },
          },
          {
            id: sourceDowngradedTextLookupId,
            name: 'Status Lookup',
            type: FieldType.SingleLineText,
            isLookup: true,
            dbFieldName: 'Status_Lookup',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            order: 4,
            createdTime: '2025-10-29T00:00:03.000Z',
            options: {},
            lookupOptions: {
              foreignTableId: missingTableId,
              linkFieldId: sourceBrokenLinkId,
              lookupFieldId: `fld${'7'.repeat(16)}`,
            },
          },
          {
            id: sourceHealthyNumberId,
            name: 'Amount',
            type: FieldType.Number,
            dbFieldName: 'Amount',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 5,
            createdTime: '2025-10-29T00:00:04.000Z',
            options: {},
          },
        ],
      } as unknown as IBaseJson['tables'][number],
      {
        id: hostTableId,
        name: 'Host',
        dbTableName: 'host',
        order: 2,
        views: [],
        fields: [
          {
            id: `fld${'1'.repeat(16)}`,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
          },
          {
            id: hostBrokenLinkId,
            name: 'Host Missing Link',
            type: FieldType.Link,
            dbFieldName: 'Host_Missing_Link',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: {
              relationship: 'manyOne',
              foreignTableId: missingTableId,
              lookupFieldId: `fld${'6'.repeat(16)}`,
              isOneWay: true,
            },
          },
          {
            id: hostDowngradedNumLookupId,
            name: 'Threshold Lookup',
            type: FieldType.Number,
            isLookup: true,
            dbFieldName: 'Threshold_Lookup',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            options: {},
            lookupOptions: {
              foreignTableId: missingTableId,
              linkFieldId: hostBrokenLinkId,
              lookupFieldId: `fld${'5'.repeat(16)}`,
            },
          },
          {
            id: condRollupInvalidLhsId,
            name: 'Count High Scores',
            type: FieldType.ConditionalRollup,
            dbFieldName: 'Count_High_Scores',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 4,
            createdTime: '2025-10-29T00:00:03.000Z',
            options: {
              foreignTableId: sourceTableId,
              lookupFieldId: sourceTitleId,
              expression: 'countall({values})',
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: sourceDowngradedNumLookupId,
                    operator: 'isGreater',
                    value: 10,
                  },
                ],
              },
            },
          },
          {
            id: condLookupInvalidLhsId,
            name: 'High Score Titles',
            type: FieldType.SingleLineText,
            isLookup: true,
            isConditionalLookup: true,
            dbFieldName: 'High_Score_Titles',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            isMultipleCellValue: true,
            order: 5,
            createdTime: '2025-10-29T00:00:04.000Z',
            options: {},
            lookupOptions: {
              foreignTableId: sourceTableId,
              lookupFieldId: sourceTitleId,
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: sourceDowngradedNumLookupId,
                    operator: 'isGreater',
                    value: 10,
                  },
                ],
              },
            },
          },
          {
            id: condRollupInvalidRhsId,
            name: 'Count Above Threshold',
            type: FieldType.ConditionalRollup,
            dbFieldName: 'Count_Above_Threshold',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 6,
            createdTime: '2025-10-29T00:00:05.000Z',
            options: {
              foreignTableId: sourceTableId,
              lookupFieldId: sourceTitleId,
              expression: 'countall({values})',
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: sourceHealthyNumberId,
                    operator: 'isGreater',
                    value: {
                      type: 'field',
                      fieldId: hostDowngradedNumLookupId,
                    },
                  },
                ],
              },
            },
          },
          {
            id: condRollupValidTextFilterId,
            name: 'Count Active',
            type: FieldType.ConditionalRollup,
            dbFieldName: 'Count_Active',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 7,
            createdTime: '2025-10-29T00:00:06.000Z',
            options: {
              foreignTableId: sourceTableId,
              lookupFieldId: sourceTitleId,
              expression: 'countall({values})',
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: sourceDowngradedTextLookupId,
                    operator: 'is',
                    value: 'Active',
                  },
                ],
              },
            },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
    ]);

    const hostFields = new Map(normalized[1].fields.map((field) => [field.id, field]));

    expect(hostFields.get(condRollupInvalidLhsId)?.type).toBe(FieldType.SingleLineText);
    expect(hostFields.get(condLookupInvalidLhsId)?.type).toBe(FieldType.SingleLineText);
    expect(hostFields.get(condLookupInvalidLhsId)?.isLookup).toBeUndefined();
    expect(hostFields.get(condLookupInvalidLhsId)?.isConditionalLookup).toBeUndefined();
    expect(hostFields.get(condRollupInvalidRhsId)?.type).toBe(FieldType.SingleLineText);
    expect(hostFields.get(condRollupValidTextFilterId)?.type).toBe(FieldType.ConditionalRollup);
  });

  it('preserves conditional equality predicate when both operands independently downgrade to text regardless of table order', () => {
    const service = Object.create(BaseImportService.prototype) as {
      normalizeDisconnectedImportTables: (tables: IBaseJson['tables']) => {
        tables: IBaseJson['tables'];
        ignoredJunctionArchiveNames: string[];
      };
    };

    const missingTableId = 'tblMissing000000001';
    const hostTableId = 'tblHost000000000001';
    const foreignTableId = 'tblForeign000000001';

    const hostTitleId = 'fldHostTitle0000001';
    const hostBrokenLinkId = 'fldHostBrokenLink01';
    const hostDowngradedNumLookupId = 'fldHostNumLookup001';
    const condRollupId = 'fldCondRollupEq0001';

    const foreignTitleId = 'fldForeignTitle0001';
    const foreignBrokenLinkId = 'fldForeignLink00001';
    const foreignDowngradedNumLookupId = 'fldForeignNumLkp001';

    const [host, foreign] = [
      {
        id: hostTableId,
        name: 'Host',
        dbTableName: 'Host',
        order: 1,
        views: [],
        fields: [
          {
            id: hostTitleId,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
            options: {},
          },
          {
            id: condRollupId,
            name: 'Matching Code Count',
            type: FieldType.ConditionalRollup,
            dbFieldName: 'Matching_Code_Count',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: {
              foreignTableId,
              lookupFieldId: foreignTitleId,
              expression: 'countall({values})',
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: foreignDowngradedNumLookupId,
                    operator: 'is',
                    value: {
                      type: 'field',
                      fieldId: hostDowngradedNumLookupId,
                    },
                  },
                ],
              },
            },
          },
          {
            id: hostBrokenLinkId,
            name: 'External Link',
            type: FieldType.Link,
            dbFieldName: 'External_Link',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: missingTableId,
              lookupFieldId: 'fldMissingPrimary01',
              isOneWay: true,
            },
          },
          {
            id: hostDowngradedNumLookupId,
            name: 'Host Code',
            type: FieldType.Number,
            isLookup: true,
            dbFieldName: 'Host_Code',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 4,
            createdTime: '2025-10-29T00:00:03.000Z',
            options: { formatting: { type: 'decimal', precision: 0 } },
            lookupOptions: {
              foreignTableId: missingTableId,
              linkFieldId: hostBrokenLinkId,
              lookupFieldId: 'fldMissingCode00001',
            },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
      {
        id: foreignTableId,
        name: 'Foreign',
        dbTableName: 'Foreign',
        order: 2,
        views: [],
        fields: [
          {
            id: foreignTitleId,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
            options: {},
          },
          {
            id: foreignBrokenLinkId,
            name: 'External Link',
            type: FieldType.Link,
            dbFieldName: 'External_Link',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: missingTableId,
              lookupFieldId: 'fldMissingPrimary01',
              isOneWay: true,
            },
          },
          {
            id: foreignDowngradedNumLookupId,
            name: 'Foreign Code',
            type: FieldType.Number,
            isLookup: true,
            dbFieldName: 'Foreign_Code',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            options: { formatting: { type: 'decimal', precision: 0 } },
            lookupOptions: {
              foreignTableId: missingTableId,
              linkFieldId: foreignBrokenLinkId,
              lookupFieldId: 'fldMissingCode00002',
            },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
    ];

    for (const order of [
      [host, foreign],
      [foreign, host],
    ]) {
      const { tables } = service.normalizeDisconnectedImportTables(order);
      const byId = new Map(
        tables.flatMap((table) => table.fields.map((field) => [field.id, field] as const))
      );
      expect(byId.get(hostDowngradedNumLookupId)?.type).toBe(FieldType.SingleLineText);
      expect(byId.get(foreignDowngradedNumLookupId)?.type).toBe(FieldType.SingleLineText);
      expect(byId.get(condRollupId)?.type).toBe(FieldType.ConditionalRollup);
    }
  });

  it('downgrades conditional fields when an unqualified RHS field reference resolves to a downgraded foreign-table field', () => {
    const service = Object.create(BaseImportService.prototype) as {
      normalizeDisconnectedImportTables: (tables: IBaseJson['tables']) => {
        tables: IBaseJson['tables'];
        ignoredJunctionArchiveNames: string[];
      };
    };

    const missingTableId = 'tblMissing000000002';
    const foreignTableId = 'tblForeign000000002';
    const hostTableId = 'tblHost000000000002';

    const foreignTitleId = 'fldForeignTitle0002';
    const foreignHealthyNumberId = 'fldForeignNum000002';
    const foreignBrokenLinkId = 'fldForeignLink00002';
    const foreignDowngradedRhsId = 'fldForeignRhs000002';

    const hostTitleId = 'fldHostTitle0000002';
    const condRollupForeignRhsId = 'fldCondRollupFRhs02';

    const { tables: normalized } = service.normalizeDisconnectedImportTables([
      {
        id: foreignTableId,
        name: 'Foreign',
        dbTableName: 'Foreign',
        order: 1,
        views: [],
        fields: [
          {
            id: foreignTitleId,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
            options: {},
          },
          {
            id: foreignHealthyNumberId,
            name: 'Amount',
            type: FieldType.Number,
            dbFieldName: 'Amount',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: { formatting: { type: 'decimal', precision: 0 } },
          },
          {
            id: foreignBrokenLinkId,
            name: 'External Link',
            type: FieldType.Link,
            dbFieldName: 'External_Link',
            dbFieldType: DbFieldType.Json,
            cellValueType: 'string',
            order: 3,
            createdTime: '2025-10-29T00:00:02.000Z',
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: missingTableId,
              lookupFieldId: 'fldMissingPrimary02',
              isOneWay: true,
            },
          },
          {
            id: foreignDowngradedRhsId,
            name: 'Foreign Threshold',
            type: FieldType.Number,
            isLookup: true,
            dbFieldName: 'Foreign_Threshold',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 4,
            createdTime: '2025-10-29T00:00:03.000Z',
            options: { formatting: { type: 'decimal', precision: 0 } },
            lookupOptions: {
              foreignTableId: missingTableId,
              linkFieldId: foreignBrokenLinkId,
              lookupFieldId: 'fldMissingThresh002',
            },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
      {
        id: hostTableId,
        name: 'Host',
        dbTableName: 'Host',
        order: 2,
        views: [],
        fields: [
          {
            id: hostTitleId,
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'Name',
            dbFieldType: DbFieldType.Text,
            cellValueType: 'string',
            isPrimary: true,
            order: 1,
            createdTime: '2025-10-29T00:00:00.000Z',
            options: {},
          },
          {
            id: condRollupForeignRhsId,
            name: 'Above Foreign Threshold',
            type: FieldType.ConditionalRollup,
            dbFieldName: 'Above_Foreign_Threshold',
            dbFieldType: DbFieldType.Real,
            cellValueType: 'number',
            order: 2,
            createdTime: '2025-10-29T00:00:01.000Z',
            options: {
              foreignTableId,
              lookupFieldId: foreignTitleId,
              expression: 'countall({values})',
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: foreignHealthyNumberId,
                    operator: 'isGreater',
                    value: {
                      type: 'field',
                      fieldId: foreignDowngradedRhsId,
                    },
                  },
                ],
              },
            },
          },
        ],
      } as unknown as IBaseJson['tables'][number],
    ]);

    const hostFields = new Map(normalized[1].fields.map((field) => [field.id, field]));
    expect(hostFields.get(condRollupForeignRhsId)?.type).toBe(FieldType.SingleLineText);
  });
});
