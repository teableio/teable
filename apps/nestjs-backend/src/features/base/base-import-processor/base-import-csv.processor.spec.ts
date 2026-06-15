import Knex from 'knex';
import { vi } from 'vitest';

import { BaseImportCsvQueueProcessor } from './base-import-csv.processor';

describe('BaseImportCsvQueueProcessor', () => {
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
