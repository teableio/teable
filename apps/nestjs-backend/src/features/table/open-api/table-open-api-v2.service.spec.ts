import { FieldType } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  executeCreateTableEndpoint,
  executeDeleteTableEndpoint,
  executeDuplicateTableEndpoint,
  executeGetTableByIdEndpoint,
  executeListTableRecordsEndpoint,
  executeRestoreTableEndpoint,
} = vi.hoisted(() => ({
  executeCreateTableEndpoint: vi.fn(),
  executeDeleteTableEndpoint: vi.fn(),
  executeDuplicateTableEndpoint: vi.fn(),
  executeGetTableByIdEndpoint: vi.fn(),
  executeListTableRecordsEndpoint: vi.fn(),
  executeRestoreTableEndpoint: vi.fn(),
}));

vi.mock('@teable/v2-contract-http-implementation/handlers', () => ({
  executeCreateTableEndpoint,
  executeDeleteTableEndpoint,
  executeDuplicateTableEndpoint,
  executeGetTableByIdEndpoint,
  executeListTableRecordsEndpoint,
  executeRestoreTableEndpoint,
}));

vi.mock('../../record/record.service', () => ({
  RecordService: class RecordService {},
}));

vi.mock('../../v2/v2-container.service', () => ({
  V2ContainerService: class V2ContainerService {},
}));

vi.mock('../../v2/v2-execution-context.factory', () => ({
  V2ExecutionContextFactory: class V2ExecutionContextFactory {},
}));

import { TableOpenApiV2Service } from './table-open-api-v2.service';

const duplicatedTableId = 'tblDuplicated';
const duplicatedTableName = 'Orders Copy';
const duplicatedViewId = 'viwDuplicated';

describe('TableOpenApiV2Service.createTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createService = (overrides?: {
    prismaService?: Record<string, unknown>;
    dbProvider?: Record<string, unknown>;
  }) =>
    new TableOpenApiV2Service(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: vi.fn().mockReturnValue({}),
        }),
        getContainer: vi.fn().mockResolvedValue({
          resolve: vi.fn().mockReturnValue({}),
        }),
      } as never,
      {
        createContext: vi.fn().mockResolvedValue({}),
      } as never,
      (overrides?.prismaService ?? {}) as never,
      {
        generateDbTableName: vi
          .fn()
          .mockImplementation((baseId: string, name: string) => `${baseId}.${name}`),
        ...overrides?.dbProvider,
      } as never,
      {} as never,
      {
        current: vi.fn().mockReturnValue(undefined),
        emitAtomic: vi.fn().mockResolvedValue(undefined),
        // Pass-through: invoke fn directly so decorated methods execute their body.
        withOperation: vi.fn().mockImplementation((_operation, fn: () => Promise<unknown>) => fn()),
      } as never,
      {} as never,
      { dataPrismaForBase: vi.fn() } as never,
      { deleteTablePrefix: vi.fn().mockResolvedValue(undefined) } as never
    );

  it('fills missing legacy link lookupFieldId and prefixes legacy dbTableName before calling v2', async () => {
    executeCreateTableEndpoint.mockResolvedValue({
      status: 400,
      body: {
        ok: false,
        error: {
          code: 'validation.invalid',
          message: 'Invalid create table',
          tags: ['validation'],
        },
      },
    });
    executeGetTableByIdEndpoint.mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        data: {
          table: {
            fields: [
              {
                id: 'fldPrimary',
                name: 'Name',
                type: FieldType.SingleLineText,
                isPrimary: true,
              },
            ],
          },
        },
      },
    });

    const service = createService();

    await expect(
      service.createTable('bseTest', {
        name: 'Links',
        dbTableName: 'legacy_table',
        fields: [
          {
            name: 'Related',
            type: FieldType.Link,
            options: {
              relationship: 'manyMany',
              foreignTableId: 'tblForeign',
            },
          },
        ],
        views: [],
        records: [],
      })
    ).rejects.toBeTruthy();

    expect(executeGetTableByIdEndpoint).toHaveBeenCalledWith(
      expect.anything(),
      { baseId: 'bseTest', tableId: 'tblForeign' },
      expect.anything()
    );
    expect(executeCreateTableEndpoint).toHaveBeenCalledTimes(1);
    expect(executeCreateTableEndpoint.mock.calls[0]?.[1]).toMatchObject({
      baseId: 'bseTest',
      name: 'Links',
      dbTableName: 'bseTest.legacy_table',
      fields: [
        {
          name: 'Related',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: 'tblForeign',
            lookupFieldId: 'fldPrimary',
          },
        },
      ],
    });
  });

  it('rebuilds legacy create-table response in chunks', async () => {
    executeCreateTableEndpoint.mockResolvedValue({
      status: 201,
      body: {
        ok: true,
        data: {
          table: {
            id: 'tblTest',
            views: [{ id: 'viwDefault' }],
          },
        },
      },
    });

    const recordIds = Array.from({ length: 1001 }, (_, index) => `rec${index + 1}`);
    executeListTableRecordsEndpoint
      .mockResolvedValueOnce({
        status: 200,
        body: {
          ok: true,
          data: {
            records: recordIds.slice(0, 1000).map((recordId) => ({
              id: recordId,
              fields: {},
            })),
            pagination: { hasMore: true },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          ok: true,
          data: {
            records: recordIds.slice(1000).map((recordId) => ({
              id: recordId,
              fields: {},
            })),
            pagination: { hasMore: false },
          },
        },
      });
    const service = createService();

    const result = await service.createTable('bseTest', {
      name: 'Orders',
      fields: [],
      views: [],
      records: Array.from({ length: 1001 }, () => ({
        fields: {},
      })),
    });

    expect(executeListTableRecordsEndpoint).toHaveBeenNthCalledWith(
      1,
      {},
      {
        tableId: 'tblTest',
        viewId: 'viwDefault',
        fieldKeyType: 'name',
        cellFormat: 'json',
        limit: 1000,
        offset: 0,
      },
      {}
    );
    expect(executeListTableRecordsEndpoint).toHaveBeenNthCalledWith(
      2,
      {},
      {
        tableId: 'tblTest',
        viewId: 'viwDefault',
        fieldKeyType: 'name',
        cellFormat: 'json',
        limit: 1,
        offset: 1000,
      },
      {}
    );
    expect(result.records).toHaveLength(1001);
    expect(result.records[0]?.id).toBe('rec1');
    expect(result.records[1000]?.id).toBe('rec1001');
  });
});

describe('TableOpenApiV2Service.duplicateTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createService = (overrides?: {
    prismaService?: Record<string, unknown>;
    dbProvider?: Record<string, unknown>;
    tableDuplicateLegacyService?: Record<string, unknown>;
  }) =>
    new TableOpenApiV2Service(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: vi.fn().mockReturnValue({}),
        }),
        getContainer: vi.fn().mockResolvedValue({
          resolve: vi.fn().mockReturnValue({}),
        }),
      } as never,
      {
        createContext: vi.fn().mockResolvedValue({}),
      } as never,
      (overrides?.prismaService ?? {}) as never,
      {
        generateDbTableName: vi
          .fn()
          .mockImplementation((baseId: string, name: string) => `${baseId}.${name}`),
        ...overrides?.dbProvider,
      } as never,
      {
        previewCrossSpaceAffectedFields: vi.fn().mockResolvedValue([]),
        duplicateTable: vi.fn(),
        ...overrides?.tableDuplicateLegacyService,
      } as never,
      {
        current: vi.fn().mockReturnValue(undefined),
        emitAtomic: vi.fn().mockResolvedValue(undefined),
        // Pass-through: invoke fn directly so decorated methods execute their body.
        withOperation: vi.fn().mockImplementation((_operation, fn: () => Promise<unknown>) => fn()),
      } as never,
      {} as never,
      { dataPrismaForBase: vi.fn() } as never,
      { deleteTablePrefix: vi.fn().mockResolvedValue(undefined) } as never
    );

  it('rebuilds the legacy duplicate-table response from the duplicated v2 table', async () => {
    executeDuplicateTableEndpoint.mockResolvedValue({
      status: 201,
      body: {
        ok: true,
        data: {
          table: {
            id: duplicatedTableId,
            name: duplicatedTableName,
            views: [
              {
                id: duplicatedViewId,
                name: 'Grid',
                type: 'grid',
              },
            ],
            fields: [
              {
                id: 'fldDuplicated',
                name: 'Name',
                type: FieldType.SingleLineText,
                isPrimary: true,
                dbFieldName: 'name_copy',
              },
            ],
          },
          fieldIdMap: {
            fldSource: 'fldDuplicated',
          },
          viewIdMap: {
            viwSource: duplicatedViewId,
          },
          events: [],
        },
      },
    });
    executeGetTableByIdEndpoint.mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        data: {
          table: {
            fields: [
              {
                id: 'fldSource',
                name: 'Name',
                type: FieldType.SingleLineText,
                isPrimary: true,
                dbFieldName: 'name',
              },
            ],
          },
        },
      },
    });

    const service = createService();

    const result = await service.duplicateTable('bseTest', 'tblSource', {
      name: duplicatedTableName,
      includeRecords: true,
    });

    expect(executeDuplicateTableEndpoint).toHaveBeenCalledWith(
      {},
      {
        baseId: 'bseTest',
        tableId: 'tblSource',
        name: duplicatedTableName,
        includeRecords: true,
      },
      {}
    );
    expect(executeGetTableByIdEndpoint).toHaveBeenCalledWith(
      expect.anything(),
      { baseId: 'bseTest', tableId: 'tblSource' },
      expect.anything()
    );
    expect(result).toMatchObject({
      id: duplicatedTableId,
      name: duplicatedTableName,
      fieldMap: {
        fldSource: 'fldDuplicated',
      },
      viewMap: {
        viwSource: duplicatedViewId,
      },
      fields: [
        {
          id: 'fldDuplicated',
          name: 'Name',
          type: FieldType.SingleLineText,
          dbFieldName: 'name',
        },
      ],
      views: [
        {
          id: duplicatedViewId,
          name: 'Grid',
          type: 'grid',
        },
      ],
    });
  });

  it('rejects cross-space duplicate instead of calling v1 duplicateTable', async () => {
    const tableDuplicateLegacyService = {
      previewCrossSpaceAffectedFields: vi
        .fn()
        .mockResolvedValue([{ fieldId: 'fldLink', fieldName: 'Orders', type: 'link' }]),
      duplicateTable: vi.fn(),
    };
    const service = createService({ tableDuplicateLegacyService });

    await expect(
      service.duplicateTable('bseTest', 'tblSource', {
        name: duplicatedTableName,
        includeRecords: true,
      })
    ).rejects.toMatchObject({
      message: 'v2 will not silently downgrade cross-space fields when duplicating a table',
      status: 400,
    });
    expect(tableDuplicateLegacyService.duplicateTable).not.toHaveBeenCalled();
    expect(executeDuplicateTableEndpoint).not.toHaveBeenCalled();
  });
});
