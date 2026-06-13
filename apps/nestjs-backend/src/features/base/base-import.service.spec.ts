import type { Readable } from 'stream';
import { DbFieldType, FieldType, HttpErrorCode } from '@teable/core';
import { BaseDuplicateMode, type IBaseJson, type ImportBaseRo } from '@teable/openapi';
import type { RestoreRecordInput } from '@teable/v2-core';
import archiver from 'archiver';
import { vi } from 'vitest';
import { CustomHttpException } from '../../custom.exception';

import { BaseImportService, formatBaseImportError } from './base-import.service';

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
    importBaseRo: Pick<ImportBaseRo, 'spaceId'>,
    onProgress?: (...args: unknown[]) => void
  ): Promise<unknown>;
  createBaseStructure: ReturnType<typeof vi.fn>;
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
  cls: unknown;
}

const dbTableName = 'bse_test.tbl_test';
const jsonColumnName = 'json_col';
const textColumnName = 'text_col';
const textCellValue = 'plain text';
const importedBaseName = 'Imported base';

const createService = () =>
  Object.create(BaseImportService.prototype) as IRestoreRecordInputBuilder;

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
        importBaseV2: BaseImportService['importBaseV2'];
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
      await expect(service.importBaseV2(importRo, onProgress)).rejects.toBe(freezeError);

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
        service.processStructure(createZipStream(structure), { spaceId: 'spcImport' })
      ).resolves.toBe(expectedResult);

      expect(service.createBaseStructure).toHaveBeenCalledWith(
        'spcImport',
        structure,
        undefined,
        undefined,
        undefined,
        undefined,
        { useTransaction: true }
      );
    });

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
      const service = Object.create(BaseImportService.prototype) as IImportBaseV2Service;

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
      service.importAttachmentsV2 = vi.fn().mockResolvedValue(undefined);
      service.importTableDataV2 = vi.fn().mockResolvedValue(undefined);
      service.importTableLinkFieldsV2 = vi.fn().mockResolvedValue(undefined);
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
        undefined
      );
      expect(commandBus.execute).toHaveBeenCalledTimes(1);
      expect(service.importTableDataV2).toHaveBeenCalledTimes(1);
      expect(service.importTableLinkFieldsV2).toHaveBeenCalledTimes(1);
    });
  });

  describe('toRestoreRecordInput', () => {
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
