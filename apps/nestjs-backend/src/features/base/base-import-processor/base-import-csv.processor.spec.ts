import { FieldType } from '@teable/core';
import type { IBaseJson } from '@teable/openapi';
import archiver from 'archiver';
import Knex from 'knex';
import { vi } from 'vitest';

import { BaseImportCsvQueueProcessor } from './base-import-csv.processor';

const createCsvZipStream = (entries: Record<string, string>) => {
  const archive = archiver('zip', { zlib: { level: 0 } });
  for (const [name, content] of Object.entries(entries)) {
    archive.append(content, { name });
  }
  void archive.finalize();
  return archive;
};

describe('BaseImportCsvQueueProcessor', () => {
  it('waits for csv entry pipelines before running persisted computed backfill', async () => {
    const structure = {
      tables: [
        {
          id: 'tblSource',
          fields: [{ id: 'fldName', dbFieldName: 'Name', type: FieldType.SingleLineText }],
        },
      ],
    } as unknown as IBaseJson;
    let chunkFinished = false;
    const recomputeForTables = vi.fn(async () => {
      expect(chunkFinished).toBe(true);
    });
    const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
      handleBaseImportCsvInScope: (job: { data: Record<string, unknown> }) => Promise<void>;
      handleChunk: ReturnType<typeof vi.fn>;
      storageAdapter: { downloadFile: ReturnType<typeof vi.fn> };
      persistedComputedBackfillService: { recomputeForTables: ReturnType<typeof vi.fn> };
      logger: { log: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    };

    processor.storageAdapter = {
      downloadFile: vi
        .fn()
        .mockResolvedValue(
          createCsvZipStream({ 'tables/tblSource.csv': '__id,Name\nrec1,Alpha' })
        ),
    };
    processor.handleChunk = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      chunkFinished = true;
    });
    processor.persistedComputedBackfillService = { recomputeForTables };
    processor.logger = { log: vi.fn(), error: vi.fn() };

    await processor.handleBaseImportCsvInScope({
      data: {
        path: 'import.zip',
        userId: 'usrImport',
        baseId: 'bseImport',
        tableIdMap: { tblSource: 'tblTarget' },
        fieldIdMap: {},
        viewIdMap: {},
        fkMap: {},
        structure,
      },
    });

    expect(processor.handleChunk).toHaveBeenCalledTimes(1);
    expect(recomputeForTables).toHaveBeenCalledWith(['tblTarget']);
  });

  it('does not write record history when importing base records', async () => {
    const executedSql: string[] = [];
    const dataKnex = Knex({ client: 'pg' });
    const dataPrisma = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: '__id' }, { name: 'fldText' }]),
      $executeRawUnsafe: vi.fn(async (sql: string) => {
        executedSql.push(sql);
        return 1;
      }),
    };
    const prismaService = {
      tableMeta: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ dbTableName: 'bse_data.tbl_imported' }),
      },
      txClient: vi.fn().mockReturnValue({
        attachmentsTable: {
          createMany: vi.fn().mockResolvedValue(undefined),
        },
      }),
    };
    const dataDbClientManager = {
      dataPrismaForBase: vi.fn().mockResolvedValue(dataPrisma),
      dataKnexForBase: vi.fn().mockResolvedValue(dataKnex),
      getDataDatabaseForBase: vi.fn().mockResolvedValue({
        url: 'postgresql://user:pass@example.test:5432/data?schema=teable_internal',
      }),
    };
    const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
      handleChunk: (
        results: Record<string, unknown>[],
        config: {
          baseId: string;
          tableId: string;
          userId: string;
          fieldIdMap: Record<string, string>;
          viewIdMap: Record<string, string>;
          fkMap: Record<string, string>;
          attachmentsFields: { dbFieldName: string; id: string }[];
          notNullFieldMap: Map<string, { dbFieldType: string; isMultipleCellValue: boolean }>;
          fieldDbNameMap: Map<string, string>;
        },
        excludeDbFieldNames: string[]
      ) => Promise<void>;
      prismaService: typeof prismaService;
      dbProvider: {
        getForeignKeysInfo: ReturnType<typeof vi.fn>;
        columnInfo: ReturnType<typeof vi.fn>;
      };
      dataDbClientManager: typeof dataDbClientManager;
    };

    processor.prismaService = prismaService;
    processor.dbProvider = {
      getForeignKeysInfo: vi.fn().mockReturnValue('SELECT * FROM foreign_keys'),
      columnInfo: vi.fn().mockReturnValue('SELECT * FROM columns'),
    };
    processor.dataDbClientManager = dataDbClientManager;
    Object.assign(processor, {
      audit: { emitAtomic: vi.fn().mockResolvedValue(undefined) },
      cls: { get: vi.fn() },
    });

    await processor.handleChunk(
      [{ __id: 'recImported', fldText: 'Imported value' }],
      {
        baseId: 'bseImport',
        tableId: 'tblImport',
        userId: 'usrImport',
        fieldIdMap: {},
        viewIdMap: {},
        fkMap: {},
        attachmentsFields: [],
        notNullFieldMap: new Map(),
        fieldDbNameMap: new Map([['fldText', 'fldMappedText']]),
      },
      []
    );

    expect(executedSql.some((sql) => sql.includes('"bse_data"."tbl_imported"'))).toBe(true);
    // Base import inserts records only — it must not generate per-cell record history
    // (the v1 hot path that bloated each chunk transaction and timed out on large tables).
    expect(executedSql.some((sql) => sql.toLowerCase().includes('record_history'))).toBe(false);

    await dataKnex.destroy();
  });

  it('drops ghost columns missing from the target table instead of aborting the insert', async () => {
    const executedSql: string[] = [];
    const dataKnex = Knex({ client: 'pg' });
    const dataPrisma = {
      $queryRawUnsafe: vi
        .fn()
        // foreign keys info
        .mockResolvedValueOnce([])
        // columnInfo: the freshly-created table only has __id + fldText, NOT the ghost column
        .mockResolvedValueOnce([{ name: '__id' }, { name: 'fldText' }]),
      $executeRawUnsafe: vi.fn(async (sql: string) => {
        executedSql.push(sql);
        return 1;
      }),
    };
    const prismaService = {
      tableMeta: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ dbTableName: 'bse_data.tbl_imported' }),
      },
      txClient: vi.fn().mockReturnValue({
        attachmentsTable: { createMany: vi.fn().mockResolvedValue(undefined) },
      }),
    };
    const dataDbClientManager = {
      dataPrismaForBase: vi.fn().mockResolvedValue(dataPrisma),
      dataKnexForBase: vi.fn().mockResolvedValue(dataKnex),
      getDataDatabaseForBase: vi.fn().mockResolvedValue({
        url: 'postgresql://user:pass@example.test:5432/data?schema=teable_internal',
      }),
    };
    const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
      handleChunk: (
        results: Record<string, unknown>[],
        config: Record<string, unknown>,
        excludeDbFieldNames: string[]
      ) => Promise<void>;
      prismaService: typeof prismaService;
      dbProvider: {
        getForeignKeysInfo: ReturnType<typeof vi.fn>;
        columnInfo: ReturnType<typeof vi.fn>;
      };
      dataDbClientManager: typeof dataDbClientManager;
    };

    processor.prismaService = prismaService;
    processor.dbProvider = {
      getForeignKeysInfo: vi.fn().mockReturnValue('SELECT * FROM foreign_keys'),
      columnInfo: vi.fn().mockReturnValue('SELECT * FROM columns'),
    };
    processor.dataDbClientManager = dataDbClientManager;
    Object.assign(processor, {
      audit: { emitAtomic: vi.fn().mockResolvedValue(undefined) },
      cls: { get: vi.fn() },
    });

    await processor.handleChunk(
      // fldGhost is an orphan physical column dumped into the .tea CSV with no matching field
      [{ __id: 'recImported', fldText: 'Imported value', fldGhost: 'orphan value' }],
      {
        baseId: 'bseImport',
        tableId: 'tblImport',
        userId: 'usrImport',
        fieldIdMap: {},
        viewIdMap: {},
        fkMap: {},
        attachmentsFields: [],
        notNullFieldMap: new Map(),
        fieldDbNameMap: new Map([['fldText', 'fldMappedText']]),
      },
      []
    );

    const dataInsert = executedSql.find((sql) => sql.includes('"bse_data"."tbl_imported"'));
    expect(dataInsert).toBeDefined();
    expect(dataInsert).toContain('"fldText"');
    expect(dataInsert).not.toContain('fldGhost');

    await dataKnex.destroy();
  });
});
