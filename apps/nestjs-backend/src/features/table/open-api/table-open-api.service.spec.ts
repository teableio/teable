import { CellValueType, DbFieldType, FieldType, Relationship } from '@teable/core';
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
      {} as never
    );

    const fields = await (
      service as unknown as {
        prepareFields: (tableId: string, fieldRos: Array<typeof nameFieldRo>) => Promise<unknown[]>;
      }
    ).prepareFields('tblTest', [nameFieldRo, linkFieldRo, lookupFieldRo, rollupFieldRo]);

    expect(fieldSupplementService.prepareCreateFields).toHaveBeenCalledWith('tblTest', [
      nameFieldRo,
      linkFieldRo,
    ]);
    expect(fieldSupplementService.prepareCreateField).toHaveBeenCalledTimes(2);
    expect(fields).toHaveLength(4);
  });
});

describe('TableOpenApiService.createTable', () => {
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
    const dataPrismaService = {
      $executeRawUnsafe: executeRawUnsafe,
    };
    const dbProvider = {
      dropTable: vi.fn().mockReturnValue('drop table "bseTest"."projects"'),
    };

    const service = new TableOpenApiService(
      prismaService as never,
      dataPrismaService as never,
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
      { invalidateDroppedTable } as never
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
    const dataPrismaService = {
      txClient: vi.fn().mockReturnValue(dataTxClient),
    };

    const service = new TableOpenApiService(
      prismaService as never,
      dataPrismaService as never,
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
      {} as never
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
    const dataPrismaService = {
      txClient: vi.fn().mockReturnValue({
        $executeRawUnsafe: executeRawUnsafe,
      }),
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
      dataPrismaService as never,
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
      tableMutationCacheInvalidator as never
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
    const dataPrismaService = {
      $queryRawUnsafe: dataQueryRawUnsafe,
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
      dataPrismaService as never,
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
      {} as never
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
    const dataPrismaService = {
      $tx: vi.fn(async (fn: (prisma: typeof dataTxClient) => Promise<unknown>) => fn(dataTxClient)),
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
      dataPrismaService as never,
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
      {} as never
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
    const dataPrismaService = {
      $tx: vi.fn(async (fn: (prisma: typeof dataTxClient) => Promise<unknown>) => fn(dataTxClient)),
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
      dataPrismaService as never,
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
      {} as never
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
