import type { Readable } from 'stream';
import { DbFieldType, FieldType } from '@teable/core';
import type { IBaseJson, ImportBaseRo } from '@teable/openapi';
import type { RestoreRecordInput } from '@teable/v2-core';
import archiver from 'archiver';
import { vi } from 'vitest';

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

const dbTableName = 'bse_test.tbl_test';
const jsonColumnName = 'json_col';
const textColumnName = 'text_col';
const textCellValue = 'plain text';

const createService = () =>
  Object.create(BaseImportService.prototype) as IRestoreRecordInputBuilder;

const createZipStream = (structure: IBaseJson) => {
  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.append(JSON.stringify(structure), { name: 'structure.json' });
  void archive.finalize();
  return archive;
};

describe('BaseImportService', () => {
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
        name: 'Imported base',
        spaceId: 'spcImport',
        order: 1,
      };
      const baseCreate = vi.fn().mockResolvedValue(createdBase);
      const baseUpdate = vi.fn().mockResolvedValue({
        ...createdBase,
        name: 'Imported base',
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
        dataDbClientManager: unknown;
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
        service.createBase('spcImport', 'Imported base', 'icon', { useTransaction: true })
      ).resolves.toMatchObject({
        id: 'bseImported',
        name: 'Imported base',
      });

      expect(service.dataDbClientManager.dataPrismaForSpace).toHaveBeenCalledWith('spcImport', {
        useTransaction: true,
      });
      expect(routedExecute).toHaveBeenCalledWith('CREATE SCHEMA "bseImported"');
      expect(fallbackExecute).not.toHaveBeenCalled();
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
