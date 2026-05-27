import Knex from 'knex';
import { vi } from 'vitest';

import { BaseImportCsvQueueProcessor } from './base-import-csv.processor';

describe('BaseImportCsvQueueProcessor', () => {
  it('writes imported record history into the routed data DB internal schema', async () => {
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
    expect(executedSql.some((sql) => sql.includes('"teable_internal"."record_history"'))).toBe(
      true
    );
    expect(executedSql.some((sql) => sql.includes('insert into "record_history"'))).toBe(false);

    await dataKnex.destroy();
  });
});
