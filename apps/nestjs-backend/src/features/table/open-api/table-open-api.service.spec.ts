import { CellValueType, DbFieldType, FieldType, Relationship } from '@teable/core';
import { ResourceType } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import { TableOpenApiService } from './table-open-api.service';

const ordersTable = 'bseTest.orders';
const renamedOrdersTable = 'bseTest.orders_renamed';
const selectLinkFieldsSql = 'select link fields';
const selectLookupFieldsSql = 'select lookup fields';

describe('TableOpenApiService.prepareFields', () => {
  it('prepares same-batch link fields before dependent lookup and rollup fields', async () => {
    const nameFieldRo = {
      id: 'fldName',
      name: 'Name',
      type: FieldType.SingleLineText,
    };
    const linkFieldRo = {
      id: 'fldLink',
      name: 'Company',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeignName',
      },
    };
    const lookupFieldRo = {
      id: 'fldLookup',
      name: 'Company Name',
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        linkFieldId: 'fldLink',
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeignName',
      },
    };
    const rollupFieldRo = {
      id: 'fldRollup',
      name: 'Company Revenue',
      type: FieldType.Rollup,
      options: {
        expression: 'sum({values})',
      },
      lookupOptions: {
        linkFieldId: 'fldLink',
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeignRevenue',
      },
    };

    const preparedNameField = {
      id: 'fldName',
      name: 'Name',
      dbFieldName: 'name',
      type: FieldType.SingleLineText,
      options: {},
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
    const preparedLinkField = {
      id: 'fldLink',
      name: 'Company',
      dbFieldName: 'company',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeignName',
        fkHostTableName: '__link_host',
        selfKeyName: '__fk_self',
        foreignKeyName: '__fk_foreign',
      },
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: undefined,
    };

    const fieldSupplementService = {
      prepareCreateFields: vi.fn().mockResolvedValue([preparedNameField, preparedLinkField]),
      prepareCreateField: vi.fn().mockImplementation(async (_tableId, fieldRo, batchFieldVos) => {
        expect(batchFieldVos).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'fldLink',
              type: FieldType.Link,
              options: expect.objectContaining({
                foreignTableId: 'tblForeign',
                fkHostTableName: '__link_host',
              }),
            }),
          ])
        );

        return {
          id: fieldRo.id,
          name: fieldRo.name,
          dbFieldName: fieldRo.id === 'fldLookup' ? 'company_name' : 'company_revenue',
          type: fieldRo.type,
          isLookup: fieldRo.isLookup,
          options: fieldRo.options ?? {},
          lookupOptions: fieldRo.lookupOptions,
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
        };
      }),
    };

    const service = new TableOpenApiService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      fieldSupplementService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );

    const fields = await (
      service as unknown as {
        prepareFields: (tableId: string, fieldRos: Array<typeof nameFieldRo>) => Promise<unknown[]>;
      }
    ).prepareFields('tblTest', [nameFieldRo, linkFieldRo, lookupFieldRo, rollupFieldRo]);

    expect(fieldSupplementService.prepareCreateFields).toHaveBeenCalledWith(
      'tblTest',
      [nameFieldRo, linkFieldRo],
      undefined,
      { useTransaction: true }
    );
    expect(fieldSupplementService.prepareCreateField).toHaveBeenCalledTimes(2);
    expect(fields).toHaveLength(4);
  });
});

describe('TableOpenApiService.createTable', () => {
  it('records legacy table creation schema operations in meta prisma', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prismaService = {
      txClient: vi.fn().mockReturnValue({
        schemaOperation: { upsert },
      }),
    };
    const cls = {
      get: vi.fn().mockReturnValue('usrTest'),
    };

    const service = new TableOpenApiService(
      prismaService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cls as never,
      {} as never,
      {} as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );

    await (
      service as unknown as {
        completeTableCreateSchemaOperation: (
          baseId: string,
          tableId: string,
          recordCount: number
        ) => Promise<void>;
      }
    ).completeTableCreateSchemaOperation('bseTest', 'tblTest', 2);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'table.create:table:tblTest' },
        create: expect.objectContaining({
          type: 'table.create',
          status: 'ready',
          phase: 'ready',
          resourceType: 'table',
          resourceId: 'tblTest',
          baseId: 'bseTest',
          tableId: 'tblTest',
          idempotencyKey: 'table.create:table:tblTest',
          payload: { recordCount: 2 },
          createdBy: 'usrTest',
          lastModifiedBy: 'usrTest',
        }),
        update: expect.objectContaining({
          type: 'table.create',
          status: 'ready',
          phase: 'ready',
          resourceType: 'table',
          resourceId: 'tblTest',
          baseId: 'bseTest',
          tableId: 'tblTest',
          payload: { recordCount: 2 },
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          lastModifiedBy: 'usrTest',
        }),
      })
    );
  });

  it('drops the data table when metadata transaction rolls back after physical creation', async () => {
    const projectsTable = 'bseTest.projects';
    const createError = new Error('field create failed');
    const executeRawUnsafe = vi.fn().mockResolvedValue(undefined);
    const invalidateDroppedTable = vi.fn().mockResolvedValue(undefined);
    const tableService = {
      createTable: vi.fn().mockResolvedValue({
        id: 'tblA',
        name: 'Projects',
        dbTableName: projectsTable,
        order: 1,
        createdTime: new Date('2026-01-01T00:00:00.000Z'),
        lastModifiedTime: null,
      }),
    };
    const preparedField = {
      id: 'fldName',
      name: 'Name',
      dbFieldName: 'name',
      type: FieldType.SingleLineText,
      options: {},
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
    const fieldSupplementService = {
      prepareCreateFields: vi.fn().mockResolvedValue([preparedField]),
    };
    const fieldCreatingService = {
      alterCreateFields: vi.fn().mockRejectedValue(createError),
    };
    const prismaService = {
      $tx: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    };
    const databaseRouter = {
      executeDataPrismaForBase: vi.fn(async (_baseId: string, sql: string) =>
        executeRawUnsafe(sql)
      ),
    };
    const dbProvider = {
      dropTable: vi.fn().mockReturnValue('drop table "bseTest"."projects"'),
    };

    const service = new TableOpenApiService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      {} as never,
      {} as never,
      tableService as never,
      {} as never,
      {} as never,
      fieldCreatingService as never,
      fieldSupplementService as never,
      {} as never,
      {} as never,
      {} as never,
      dbProvider as never,
      {} as never,
      {} as never,
      {} as never,
      { invalidateDroppedTable } as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );

    await expect(
      service.createTable('bseTest', {
        name: 'Projects',
        fields: [{ id: 'fldName', name: 'Name', type: FieldType.SingleLineText }],
        views: [],
        records: [],
      } as never)
    ).rejects.toThrow(createError);

    expect(dbProvider.dropTable).toHaveBeenCalledWith(projectsTable);
    expect(executeRawUnsafe).toHaveBeenCalledWith('drop table "bseTest"."projects"');
    expect(invalidateDroppedTable).toHaveBeenCalledWith('bseTest.projects');
  });
});

describe('TableOpenApiService.cleanTablesRelatedData', () => {
  it('routes metadata cleanup to meta prisma and trash/history cleanup to data prisma', async () => {
    const metaTxClient = {
      field: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      view: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      attachmentsTable: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      ops: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      tableMeta: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      trash: { deleteMany: vi.fn().mockResolvedValue(undefined) },
    };
    const dataTxClient = {
      recordHistory: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      tableTrash: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      recordTrash: { deleteMany: vi.fn().mockResolvedValue(undefined) },
    };
    const prismaService = {
      txClient: vi.fn().mockReturnValue(metaTxClient),
    };
    const databaseRouter = {
      dataPrismaForBase: vi.fn().mockResolvedValue(dataTxClient),
    };

    const service = new TableOpenApiService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );

    await service.cleanTablesRelatedData('bseTest', ['tblA', 'tblB']);

    expect(metaTxClient.field.deleteMany).toHaveBeenCalledWith({
      where: { tableId: { in: ['tblA', 'tblB'] } },
    });
    expect(metaTxClient.trash.deleteMany).toHaveBeenCalledWith({
      where: {
        resourceId: { in: ['tblA', 'tblB'] },
        resourceType: 'table',
      },
    });
    expect(dataTxClient.recordHistory.deleteMany).toHaveBeenCalledWith({
      where: { tableId: { in: ['tblA', 'tblB'] } },
    });
    expect(dataTxClient.tableTrash.deleteMany).toHaveBeenCalledWith({
      where: { tableId: { in: ['tblA', 'tblB'] } },
    });
    expect(dataTxClient.recordTrash.deleteMany).toHaveBeenCalledWith({
      where: { tableId: { in: ['tblA', 'tblB'] } },
    });
    expect(databaseRouter.dataPrismaForBase).toHaveBeenCalledWith('bseTest', undefined);
  });

  it('uses the routed data transaction client when requested', async () => {
    const metaTxClient = {
      field: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      view: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      attachmentsTable: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      ops: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      tableMeta: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      trash: { deleteMany: vi.fn().mockResolvedValue(undefined) },
    };
    const dataTxClient = {
      recordHistory: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      tableTrash: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      recordTrash: { deleteMany: vi.fn().mockResolvedValue(undefined) },
    };
    const dataRootClient = {
      txClient: vi.fn().mockReturnValue(dataTxClient),
      recordHistory: { deleteMany: vi.fn() },
      tableTrash: { deleteMany: vi.fn() },
      recordTrash: { deleteMany: vi.fn() },
    };
    const prismaService = {
      txClient: vi.fn().mockReturnValue(metaTxClient),
    };
    const databaseRouter = {
      dataPrismaForBase: vi.fn().mockResolvedValue(dataRootClient),
    };

    const service = new TableOpenApiService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );

    await service.cleanTablesRelatedData('bseTest', ['tblA'], { useTransaction: true });

    expect(databaseRouter.dataPrismaForBase).toHaveBeenCalledWith('bseTest', {
      useTransaction: true,
    });
    expect(dataRootClient.txClient).toHaveBeenCalled();
    expect(dataTxClient.recordHistory.deleteMany).toHaveBeenCalledWith({
      where: { tableId: { in: ['tblA'] } },
    });
    expect(dataRootClient.recordHistory.deleteMany).not.toHaveBeenCalled();
  });
});

describe('TableOpenApiService.dropTables', () => {
  it('loads table metadata from meta prisma and executes physical drops on data prisma', async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(undefined);
    const metaTxClient = {
      tableMeta: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'tblA',
            baseId: 'bseTest',
            dbTableName: '"bseTest"."tblA"',
            version: 3,
            deletedTime: null,
          },
        ]),
      },
    };
    const prismaService = {
      txClient: vi.fn().mockReturnValue(metaTxClient),
    };
    const databaseRouter = {
      executeDataPrismaForTable: vi.fn(async (_tableId: string, sql: string) =>
        executeRawUnsafe(sql)
      ),
    };
    const batchService = {
      saveRawOps: vi.fn().mockResolvedValue(undefined),
    };
    const dbProvider = {
      dropTable: vi.fn().mockReturnValue('drop table "bseTest"."tblA"'),
    };
    const tableMutationCacheInvalidator = {
      invalidateDroppedTable: vi.fn().mockResolvedValue(undefined),
    };

    const service = new TableOpenApiService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      batchService as never,
      dbProvider as never,
      {} as never,
      {} as never,
      {} as never,
      tableMutationCacheInvalidator as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );

    await service.dropTables(['tblA']);

    expect(metaTxClient.tableMeta.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['tblA'] } },
      select: { dbTableName: true, version: true, id: true, baseId: true, deletedTime: true },
    });
    expect(batchService.saveRawOps).toHaveBeenCalledWith('bseTest', 'del', 'tbl', [
      { docId: 'tblA', version: 3 },
    ]);
    expect(executeRawUnsafe).toHaveBeenCalledWith('drop table "bseTest"."tblA"');
    expect(tableMutationCacheInvalidator.invalidateDroppedTable).toHaveBeenCalledWith(
      '"bseTest"."tblA"'
    );
  });

  const buildService = (dropError: Error, { isMetaFallback = true } = {}) => {
    const metaTxClient = {
      tableMeta: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'tblA',
            baseId: 'bseTest',
            dbTableName: '"bseTest"."tblA"',
            version: 3,
            deletedTime: new Date(),
          },
        ]),
      },
    };
    const databaseRouter = {
      executeDataPrismaForTable: vi.fn().mockRejectedValue(dropError),
      isMetaFallbackForBase: vi.fn().mockResolvedValue(isMetaFallback),
    };
    const tableMutationCacheInvalidator = {
      invalidateDroppedTable: vi.fn().mockResolvedValue(undefined),
    };
    const service = new TableOpenApiService(
      { txClient: vi.fn().mockReturnValue(metaTxClient) } as never,
      databaseRouter as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { saveRawOps: vi.fn() } as never,
      { dropTable: vi.fn().mockReturnValue('drop table "bseTest"."tblA"') } as never,
      {} as never,
      {} as never,
      {} as never,
      tableMutationCacheInvalidator as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );
    return { service, databaseRouter, tableMutationCacheInvalidator };
  };

  it('tolerates a failed physical drop on a bound (BYODB) data database', async () => {
    const { service, tableMutationCacheInvalidator } = buildService(
      new Error('(ENOTFOUND) tenant/user postgres.abc not found'),
      { isMetaFallback: false }
    );

    await expect(service.dropTables(['tblA'])).resolves.toBeUndefined();
    expect(tableMutationCacheInvalidator.invalidateDroppedTable).toHaveBeenCalledWith(
      '"bseTest"."tblA"'
    );
  });

  it('classifies the drop failure without re-migrating the unreachable database', async () => {
    const { service, databaseRouter } = buildService(
      new Error('(ENOTFOUND) tenant/user postgres.abc not found'),
      { isMetaFallback: false }
    );

    await service.dropTables(['tblA']);

    expect(databaseRouter.isMetaFallbackForBase).toHaveBeenCalledWith('bseTest', {
      useTransaction: true,
    });
  });

  it('rethrows platform data DB errors from the physical drop', async () => {
    const { service } = buildService(
      new Error("Can't reach database server at `db.example.com:5432`")
    );

    await expect(service.dropTables(['tblA'])).rejects.toThrow("Can't reach database server");
  });
});

describe('TableOpenApiService.cleanTablesRelatedData', () => {
  const buildService = (
    dataDbError?: Error,
    {
      isMetaFallback = false,
      tableTrashError,
    }: { isMetaFallback?: boolean; tableTrashError?: Error } = {}
  ) => {
    const deleteMany = () => vi.fn().mockResolvedValue({ count: 0 });
    const metaTxClient = {
      field: { deleteMany: deleteMany() },
      view: { deleteMany: deleteMany() },
      attachmentsTable: { deleteMany: deleteMany() },
      ops: { deleteMany: deleteMany() },
      tableMeta: { deleteMany: deleteMany() },
      trash: { deleteMany: deleteMany() },
    };
    const dataPrisma = {
      recordHistory: { deleteMany: deleteMany() },
      tableTrash: {
        deleteMany: tableTrashError ? vi.fn().mockRejectedValue(tableTrashError) : deleteMany(),
      },
      recordTrash: { deleteMany: deleteMany() },
    };
    const databaseRouter = {
      dataPrismaForBase: dataDbError
        ? vi.fn().mockRejectedValue(dataDbError)
        : vi.fn().mockResolvedValue(dataPrisma),
      isMetaFallbackForBase: vi.fn().mockResolvedValue(isMetaFallback),
    };
    const service = new TableOpenApiService(
      { txClient: vi.fn().mockReturnValue(metaTxClient) } as never,
      databaseRouter as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );
    return { service, databaseRouter, metaTxClient, dataPrisma };
  };

  it('purges record history and trash snapshots on the data database', async () => {
    const { service, dataPrisma, metaTxClient } = buildService();

    await service.cleanTablesRelatedData('bseTest', ['tblA'], { useTransaction: true });

    expect(dataPrisma.recordHistory.deleteMany).toHaveBeenCalledWith({
      where: { tableId: { in: ['tblA'] } },
    });
    expect(dataPrisma.tableTrash.deleteMany).toHaveBeenCalled();
    expect(dataPrisma.recordTrash.deleteMany).toHaveBeenCalled();
    expect(metaTxClient.trash.deleteMany).toHaveBeenCalled();
  });

  it('still removes the meta trash row when the bound (BYODB) data database is gone', async () => {
    const { service, metaTxClient, databaseRouter } = buildService(
      new Error('(ENOTFOUND) tenant/user postgres.abc not found'),
      { isMetaFallback: false }
    );

    await expect(
      service.cleanTablesRelatedData('bseTest', ['tblA'], { useTransaction: true })
    ).resolves.toBeUndefined();

    expect(metaTxClient.trash.deleteMany).toHaveBeenCalledWith({
      where: { resourceId: { in: ['tblA'] }, resourceType: ResourceType.Table },
    });
    expect(databaseRouter.isMetaFallbackForBase).toHaveBeenCalledWith('bseTest', {
      useTransaction: true,
    });
  });

  it('rethrows platform data DB errors from the related-data cleanup', async () => {
    const { service } = buildService(
      new Error("Can't reach database server at `db.example.com:5432`"),
      { isMetaFallback: true }
    );

    await expect(
      service.cleanTablesRelatedData('bseTest', ['tblA'], { useTransaction: true })
    ).rejects.toThrow("Can't reach database server");
  });

  it('keeps purging after swallowing one relation that the bound database never had', async () => {
    const { service, dataPrisma, metaTxClient } = buildService(undefined, {
      isMetaFallback: false,
      tableTrashError: new Error('relation "table_trash" does not exist'),
    });

    await expect(
      service.cleanTablesRelatedData('bseTest', ['tblA'], { useTransaction: true })
    ).resolves.toBeUndefined();

    expect(dataPrisma.recordTrash.deleteMany).toHaveBeenCalled();
    expect(metaTxClient.trash.deleteMany).toHaveBeenCalled();
  });

  it('keeps the meta trash row when the cleanup failure is rethrown', async () => {
    const { service, metaTxClient } = buildService(
      new Error("Can't reach database server at `db.example.com:5432`"),
      { isMetaFallback: true }
    );

    await expect(
      service.cleanTablesRelatedData('bseTest', ['tblA'], { useTransaction: true })
    ).rejects.toThrow();

    expect(metaTxClient.trash.deleteMany).not.toHaveBeenCalled();
  });
});

describe('TableOpenApiService.sqlQuery', () => {
  it('executes filtered table SQL on the data database', async () => {
    const metaQueryRawUnsafe = vi.fn();
    const dataQueryRawUnsafe = vi.fn().mockResolvedValue([{ __id: 'recA' }]);
    const prismaService = {
      tableMeta: {
        findFirstOrThrow: vi.fn().mockResolvedValue({ dbTableName: ordersTable }),
      },
      $queryRawUnsafe: metaQueryRawUnsafe,
    };
    const databaseRouter = {
      queryDataPrismaForTable: vi.fn((_tableId: string, sql: string) => dataQueryRawUnsafe(sql)),
    };
    const recordService = {
      buildFilterSortQuery: vi.fn().mockResolvedValue({
        queryBuilder: {
          toString: () => 'select * from "bseTest"."orders"',
        },
      }),
    };

    const service = new TableOpenApiService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      {} as never,
      recordService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );

    await service.sqlQuery('tblOrders', 'viwGrid', `select * from ${ordersTable}`);

    expect(dataQueryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('WITH base AS'));
    expect(metaQueryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('TableOpenApiService.updateDbTableName', () => {
  it('renames the physical table on the data database and updates metadata on the meta database', async () => {
    const dataExecuteRawUnsafe = vi.fn().mockResolvedValue(undefined);
    const linkFieldUpdate = vi.fn().mockResolvedValue(undefined);
    const metaTxClient = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'fldLink',
            options: JSON.stringify({
              relationship: Relationship.ManyMany,
              foreignTableId: 'tblForeign',
              fkHostTableName: ordersTable,
              selfKeyName: '__fk_self',
              foreignKeyName: '__fk_foreign',
            }),
          },
        ])
        .mockResolvedValueOnce([]),
      field: {
        update: linkFieldUpdate,
      },
    };
    const prismaService = {
      tableMeta: {
        findFirst: vi.fn().mockResolvedValue(null),
        findFirstOrThrow: vi.fn().mockResolvedValue({ dbTableName: ordersTable }),
      },
      $queryRawUnsafe: vi.fn(),
      $tx: vi.fn(async (fn: (prisma: typeof metaTxClient) => Promise<unknown>) => fn(metaTxClient)),
    };
    const dataTxClient = {
      $executeRawUnsafe: dataExecuteRawUnsafe,
    };
    const databaseRouter = {
      dataPrismaTransactionForTable: vi.fn(
        async (_tableId: string, fn: (prisma: typeof dataTxClient) => Promise<unknown>) =>
          fn(dataTxClient)
      ),
    };
    const tableService = {
      updateTable: vi.fn().mockResolvedValue(undefined),
    };
    const dbProvider = {
      joinDbTableName: vi.fn().mockReturnValue(renamedOrdersTable),
      optionsQuery: vi.fn().mockReturnValue(selectLinkFieldsSql),
      lookupOptionsQuery: vi.fn().mockReturnValue(selectLookupFieldsSql),
      renameTableName: vi
        .fn()
        .mockImplementation((from: string, to: string) => [`rename ${from} to ${to}`]),
    };

    const service = new TableOpenApiService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      {} as never,
      {} as never,
      tableService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dbProvider as never,
      { bigTransactionTimeout: 1000 } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );

    await service.updateDbTableName('bseTest', 'tblOrders', 'orders_renamed');

    expect(dataExecuteRawUnsafe).toHaveBeenCalledWith(
      `rename ${ordersTable} to ${renamedOrdersTable}`
    );
    expect(prismaService.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(metaTxClient.$queryRawUnsafe).toHaveBeenCalledWith(selectLinkFieldsSql);
    expect(linkFieldUpdate).toHaveBeenCalledWith({
      where: { id: 'fldLink' },
      data: {
        options: JSON.stringify({
          relationship: Relationship.ManyMany,
          foreignTableId: 'tblForeign',
          fkHostTableName: renamedOrdersTable,
          selfKeyName: '__fk_self',
          foreignKeyName: '__fk_foreign',
        }),
      },
    });
    expect(tableService.updateTable).toHaveBeenCalledWith('bseTest', 'tblOrders', {
      dbTableName: renamedOrdersTable,
    });
  });

  it('rolls back the data rename when metadata update fails', async () => {
    const metadataError = new Error('metadata update failed');
    const dataExecuteRawUnsafe = vi.fn().mockResolvedValue(undefined);
    const prismaService = {
      tableMeta: {
        findFirst: vi.fn().mockResolvedValue(null),
        findFirstOrThrow: vi.fn().mockResolvedValue({ dbTableName: ordersTable }),
      },
      $tx: vi.fn().mockRejectedValue(metadataError),
    };
    const dataTxClient = {
      $executeRawUnsafe: dataExecuteRawUnsafe,
    };
    const databaseRouter = {
      dataPrismaTransactionForTable: vi.fn(
        async (_tableId: string, fn: (prisma: typeof dataTxClient) => Promise<unknown>) =>
          fn(dataTxClient)
      ),
    };
    const dbProvider = {
      joinDbTableName: vi.fn().mockReturnValue(renamedOrdersTable),
      optionsQuery: vi.fn().mockReturnValue(selectLinkFieldsSql),
      lookupOptionsQuery: vi.fn().mockReturnValue(selectLookupFieldsSql),
      renameTableName: vi
        .fn()
        .mockImplementation((from: string, to: string) => [`rename ${from} to ${to}`]),
    };

    const service = new TableOpenApiService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dbProvider as never,
      { bigTransactionTimeout: 1000 } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { deleteTablePrefix: async () => undefined } as never
    );

    await expect(
      service.updateDbTableName('bseTest', 'tblOrders', 'orders_renamed')
    ).rejects.toThrow(metadataError);

    expect(dataExecuteRawUnsafe).toHaveBeenNthCalledWith(
      1,
      `rename ${ordersTable} to ${renamedOrdersTable}`
    );
    expect(dataExecuteRawUnsafe).toHaveBeenNthCalledWith(
      2,
      `rename ${renamedOrdersTable} to ${ordersTable}`
    );
  });
});
