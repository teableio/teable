import { FieldType } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  executeCreateTableEndpoint,
  executeDeleteTableEndpoint,
  executeDuplicateTableEndpoint,
  executeRestoreTableEndpoint,
} = vi.hoisted(() => ({
  executeCreateTableEndpoint: vi.fn(),
  executeDeleteTableEndpoint: vi.fn(),
  executeDuplicateTableEndpoint: vi.fn(),
  executeRestoreTableEndpoint: vi.fn(),
}));

vi.mock('@teable/v2-contract-http-implementation/handlers', () => ({
  executeCreateTableEndpoint,
  executeDeleteTableEndpoint,
  executeDuplicateTableEndpoint,
  executeRestoreTableEndpoint,
}));

vi.mock('../table.service', () => ({
  TableService: class TableService {},
}));

vi.mock('../../field/open-api/field-open-api.service', () => ({
  FieldOpenApiService: class FieldOpenApiService {},
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

vi.mock('../../view/view.service', () => ({
  ViewService: class ViewService {},
}));

import { TableOpenApiV2Service } from './table-open-api-v2.service';

describe('TableOpenApiV2Service.createTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createService = (overrides?: {
    tableService?: Record<string, unknown>;
    fieldOpenApiService?: Record<string, unknown>;
    viewService?: Record<string, unknown>;
    recordService?: Record<string, unknown>;
    prismaService?: Record<string, unknown>;
    dbProvider?: Record<string, unknown>;
  }) =>
    new TableOpenApiV2Service(
      {
        getContainer: vi.fn().mockResolvedValue({
          resolve: vi.fn().mockReturnValue({}),
        }),
      } as never,
      {
        createContext: vi.fn().mockResolvedValue({}),
      } as never,
      (overrides?.tableService ?? {}) as never,
      (overrides?.fieldOpenApiService ?? {}) as never,
      (overrides?.viewService ?? {}) as never,
      (overrides?.recordService ?? {}) as never,
      (overrides?.prismaService ?? {}) as never,
      {
        generateDbTableName: vi
          .fn()
          .mockImplementation((baseId: string, name: string) => `${baseId}.${name}`),
        ...overrides?.dbProvider,
      } as never
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

    const fieldOpenApiService = {
      getFields: vi.fn().mockResolvedValue([
        {
          id: 'fldPrimary',
          name: 'Name',
          type: FieldType.SingleLineText,
          isPrimary: true,
        },
      ]),
    };

    const service = createService({
      fieldOpenApiService,
    });

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

    expect(fieldOpenApiService.getFields).toHaveBeenCalledWith('tblForeign', {
      filterHidden: false,
    });
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
          },
        },
      },
    });

    const recordIds = Array.from({ length: 1001 }, (_, index) => `rec${index + 1}`);
    const tableService = {
      getTableMeta: vi.fn().mockResolvedValue({
        id: 'tblTest',
        name: 'Orders',
        dbTableName: 'bseTest.orders',
        defaultViewId: 'viwDefault',
      }),
    };
    const fieldOpenApiService = {
      getFields: vi.fn().mockResolvedValue([
        {
          id: 'fldName',
          name: 'Name',
          type: FieldType.SingleLineText,
        },
      ]),
    };
    const viewService = {
      getViews: vi.fn().mockResolvedValue([
        {
          id: 'viwDefault',
          name: 'Grid',
          type: 'grid',
        },
      ]),
    };
    const recordService = {
      getDocIdsByQuery: vi
        .fn()
        .mockResolvedValueOnce({ ids: recordIds.slice(0, 1000) })
        .mockResolvedValueOnce({ ids: recordIds.slice(1000) }),
      getSnapshotBulkWithPermission: vi.fn().mockResolvedValue(
        [...recordIds].reverse().map((recordId) => ({
          data: {
            id: recordId,
            name: recordId,
            fields: {},
          },
        }))
      ),
    };

    const service = createService({
      tableService,
      fieldOpenApiService,
      viewService,
      recordService,
    });

    const result = await service.createTable('bseTest', {
      name: 'Orders',
      fields: [],
      views: [],
      records: Array.from({ length: 1001 }, () => ({
        fields: {},
      })),
    });

    expect(recordService.getDocIdsByQuery).toHaveBeenNthCalledWith(1, 'tblTest', {
      viewId: 'viwDefault',
      skip: 0,
      take: 1000,
    });
    expect(recordService.getDocIdsByQuery).toHaveBeenNthCalledWith(2, 'tblTest', {
      viewId: 'viwDefault',
      skip: 1000,
      take: 1,
    });
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
    tableService?: Record<string, unknown>;
    fieldOpenApiService?: Record<string, unknown>;
    viewService?: Record<string, unknown>;
    recordService?: Record<string, unknown>;
    prismaService?: Record<string, unknown>;
    dbProvider?: Record<string, unknown>;
  }) =>
    new TableOpenApiV2Service(
      {
        getContainer: vi.fn().mockResolvedValue({
          resolve: vi.fn().mockReturnValue({}),
        }),
      } as never,
      {
        createContext: vi.fn().mockResolvedValue({}),
      } as never,
      (overrides?.tableService ?? {}) as never,
      (overrides?.fieldOpenApiService ?? {}) as never,
      (overrides?.viewService ?? {}) as never,
      (overrides?.recordService ?? {}) as never,
      (overrides?.prismaService ?? {}) as never,
      {
        generateDbTableName: vi
          .fn()
          .mockImplementation((baseId: string, name: string) => `${baseId}.${name}`),
        ...overrides?.dbProvider,
      } as never
    );

  it('rebuilds the legacy duplicate-table response from the duplicated v2 table', async () => {
    executeDuplicateTableEndpoint.mockResolvedValue({
      status: 201,
      body: {
        ok: true,
        data: {
          table: {
            id: 'tblDuplicated',
          },
          fieldIdMap: {
            fldSource: 'fldDuplicated',
          },
          viewIdMap: {
            viwSource: 'viwDuplicated',
          },
          events: [],
        },
      },
    });

    const tableService = {
      getTableMeta: vi.fn().mockResolvedValue({
        id: 'tblDuplicated',
        name: 'Orders Copy',
        dbTableName: 'bseTest.orders_copy',
        defaultViewId: 'viwDuplicated',
      }),
    };
    const fieldOpenApiService = {
      getFields: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'fldSource',
            name: 'Name',
            type: FieldType.SingleLineText,
            isPrimary: true,
            dbFieldName: 'name',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'fldDuplicated',
            name: 'Name',
            type: FieldType.SingleLineText,
            isPrimary: true,
            dbFieldName: 'name_copy',
          },
        ]),
    };
    const viewService = {
      getViews: vi.fn().mockResolvedValue([
        {
          id: 'viwDuplicated',
          name: 'Grid',
          type: 'grid',
        },
      ]),
    };
    const prismaService = {
      view: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'viwSource',
            filter:
              '{"conjunction":"and","filterSet":[{"fieldId":"fldSource","operator":"is","value":"x"}]}',
            sort: null,
            group: null,
            options: null,
            columnMeta: '{"fldSource":{"order":0}}',
            enableShare: true,
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const service = createService({
      tableService,
      fieldOpenApiService,
      viewService,
      prismaService,
    });

    const result = await service.duplicateTable('bseTest', 'tblSource', {
      name: 'Orders Copy',
      includeRecords: true,
    });

    expect(executeDuplicateTableEndpoint).toHaveBeenCalledWith(
      {},
      {
        baseId: 'bseTest',
        tableId: 'tblSource',
        name: 'Orders Copy',
        includeRecords: true,
      },
      {}
    );
    expect(prismaService.view.findMany).toHaveBeenCalledWith({
      where: {
        tableId: 'tblSource',
        deletedTime: null,
      },
      select: {
        id: true,
        filter: true,
        sort: true,
        group: true,
        options: true,
        columnMeta: true,
        enableShare: true,
      },
    });
    expect(prismaService.view.update).toHaveBeenCalledWith({
      where: {
        id: 'viwDuplicated',
      },
      data: {
        filter:
          '{"conjunction":"and","filterSet":[{"fieldId":"fldDuplicated","operator":"is","value":"x"}]}',
        sort: null,
        group: null,
        options: null,
        columnMeta: '{"fldDuplicated":{"order":0}}',
        enableShare: true,
      },
    });
    expect(tableService.getTableMeta).toHaveBeenCalledWith('bseTest', 'tblDuplicated');
    expect(fieldOpenApiService.getFields).toHaveBeenNthCalledWith(1, 'tblSource', {
      filterHidden: false,
    });
    expect(fieldOpenApiService.getFields).toHaveBeenNthCalledWith(2, 'tblDuplicated', {
      filterHidden: false,
    });
    expect(viewService.getViews).toHaveBeenCalledWith('tblDuplicated');
    expect(result).toMatchObject({
      id: 'tblDuplicated',
      name: 'Orders Copy',
      fieldMap: {
        fldSource: 'fldDuplicated',
      },
      viewMap: {
        viwSource: 'viwDuplicated',
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
          id: 'viwDuplicated',
          name: 'Grid',
          type: 'grid',
        },
      ],
    });
  });
});
