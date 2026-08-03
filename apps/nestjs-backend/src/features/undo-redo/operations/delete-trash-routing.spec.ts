import { FieldKeyType } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { DeleteFieldsOperation } from './delete-fields.operation';
import { DeleteRecordsOperation } from './delete-records.operation';
import { DeleteViewOperation } from './delete-view.operation';

describe('trash-backed undo operations', () => {
  it('DeleteFieldsOperation reads and clears table trash from the data prisma service', async () => {
    const fieldOpenApiService = {
      createFields: vi.fn().mockResolvedValue(undefined),
    };
    const recordOpenApiService = {
      updateRecords: vi.fn().mockResolvedValue(undefined),
    };
    const dataPrismaService = {
      tableTrash: {
        count: vi.fn().mockResolvedValue(1),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const dataDbClientManager = {
      dataPrismaForTable: vi.fn().mockResolvedValue(dataPrismaService),
    };
    const operation = new DeleteFieldsOperation(
      fieldOpenApiService as never,
      recordOpenApiService as never,
      dataDbClientManager as never
    );

    await operation.undo({
      name: 'DeleteFields',
      params: { tableId: 'tbl1' },
      result: {
        fields: [{ id: 'fld1', name: 'Name' }],
        records: [{ id: 'rec1', fields: { fld1: 'restored', fld2: null } }],
      },
      operationId: 'otrash1',
    } as never);

    expect(dataPrismaService.tableTrash.count).toHaveBeenCalledWith({
      where: { id: 'otrash1' },
    });
    expect(dataDbClientManager.dataPrismaForTable).toHaveBeenCalledWith('tbl1', {
      useTransaction: true,
    });
    expect(fieldOpenApiService.createFields).toHaveBeenCalledWith(
      'tbl1',
      [{ id: 'fld1', name: 'Name' }],
      undefined,
      { restoreViewOrder: true }
    );
    expect(recordOpenApiService.updateRecords).toHaveBeenCalledWith('tbl1', {
      fieldKeyType: FieldKeyType.Id,
      records: [{ id: 'rec1', fields: { fld1: 'restored' } }],
    });
    expect(dataPrismaService.tableTrash.delete).toHaveBeenCalledWith({
      where: { id: 'otrash1' },
    });
  });

  it('DeleteFieldsOperation restores only non-empty field values from sparse v2 compat snapshots', async () => {
    const fieldOpenApiService = {
      createFields: vi.fn().mockResolvedValue(undefined),
    };
    const recordOpenApiService = {
      updateRecords: vi.fn().mockResolvedValue(undefined),
    };
    const dataPrismaService = {
      tableTrash: {
        count: vi.fn().mockResolvedValue(1),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const dataDbClientManager = {
      dataPrismaForTable: vi.fn().mockResolvedValue(dataPrismaService),
    };
    const operation = new DeleteFieldsOperation(
      fieldOpenApiService as never,
      recordOpenApiService as never,
      dataDbClientManager as never
    );

    await operation.undo({
      name: 'DeleteFields',
      params: { tableId: 'tbl1' },
      result: {
        fields: [{ id: 'fld1', name: 'Name' }],
        records: [
          { id: 'rec1', fields: { fld1: null } },
          { id: 'rec2', fields: { fld1: [], fld2: undefined } },
          { id: 'rec3', fields: { fld1: 'value' } },
          { id: 'rec4', fields: { fld1: 0, fld2: false, fld3: '' } },
        ],
      },
      operationId: 'otrash1',
    } as never);

    expect(recordOpenApiService.updateRecords).toHaveBeenCalledTimes(1);
    expect(recordOpenApiService.updateRecords).toHaveBeenCalledWith('tbl1', {
      fieldKeyType: FieldKeyType.Id,
      records: [
        { id: 'rec3', fields: { fld1: 'value' } },
        { id: 'rec4', fields: { fld1: 0, fld2: false, fld3: '' } },
      ],
    });
  });

  it('DeleteFieldsOperation restores field values in chunks', async () => {
    const fieldOpenApiService = {
      createFields: vi.fn().mockResolvedValue(undefined),
    };
    const recordOpenApiService = {
      updateRecords: vi.fn().mockResolvedValue(undefined),
    };
    const dataPrismaService = {
      tableTrash: {
        count: vi.fn().mockResolvedValue(1),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const dataDbClientManager = {
      dataPrismaForTable: vi.fn().mockResolvedValue(dataPrismaService),
    };
    const operation = new DeleteFieldsOperation(
      fieldOpenApiService as never,
      recordOpenApiService as never,
      dataDbClientManager as never
    );
    const records = Array.from({ length: 1001 }, (_, index) => ({
      id: `rec${index}`,
      fields: { fld1: `value-${index}` },
    }));

    await operation.undo({
      name: 'DeleteFields',
      params: { tableId: 'tbl1' },
      result: {
        fields: [{ id: 'fld1', name: 'Name' }],
        records,
      },
      operationId: 'otrash1',
    } as never);

    expect(recordOpenApiService.updateRecords).toHaveBeenCalledTimes(3);
    expect(recordOpenApiService.updateRecords.mock.calls[0][1].records).toHaveLength(500);
    expect(recordOpenApiService.updateRecords.mock.calls[1][1].records).toHaveLength(500);
    expect(recordOpenApiService.updateRecords.mock.calls[2][1].records).toHaveLength(1);
  });

  it('DeleteRecordsOperation restores records before deleting data-db trash snapshots', async () => {
    const recordOpenApiService = {
      multipleCreateRecords: vi.fn().mockResolvedValue(undefined),
    };
    const tableTrashDelete = vi.fn().mockResolvedValue(undefined);
    const recordTrashDeleteMany = vi.fn().mockResolvedValue(undefined);
    const dataPrismaService = {
      tableTrash: {
        count: vi.fn().mockResolvedValue(1),
      },
      $tx: vi.fn().mockImplementation(async (fn: (prisma: unknown) => Promise<unknown>) => {
        return await fn({
          tableTrash: { delete: tableTrashDelete },
          recordTrash: { deleteMany: recordTrashDeleteMany },
        });
      }),
    };
    const dataDbClientManager = {
      dataPrismaForTable: vi.fn().mockResolvedValue(dataPrismaService),
    };
    const operation = new DeleteRecordsOperation(
      recordOpenApiService as never,
      { bigTransactionTimeout: 60_000 } as never,
      dataDbClientManager as never
    );

    await operation.undo({
      name: 'DeleteRecords',
      params: { tableId: 'tbl1' },
      result: {
        records: [{ id: 'rec1' }, { id: 'rec2' }],
      },
      operationId: 'otrash2',
    } as never);

    expect(recordOpenApiService.multipleCreateRecords).toHaveBeenCalledWith('tbl1', {
      fieldKeyType: FieldKeyType.Id,
      records: [{ id: 'rec1' }, { id: 'rec2' }],
    });
    expect(dataDbClientManager.dataPrismaForTable).toHaveBeenCalledWith('tbl1', {
      useTransaction: true,
    });
    expect(dataPrismaService.$tx).toHaveBeenCalled();
    expect(tableTrashDelete).toHaveBeenCalledWith({
      where: { id: 'otrash2' },
    });
    expect(recordTrashDeleteMany).toHaveBeenCalledWith({
      where: {
        tableId: 'tbl1',
        recordId: { in: ['rec1', 'rec2'] },
      },
    });
  });

  it('DeleteViewOperation restores metadata and clears its trash marker from the data prisma service', async () => {
    const viewOpenApiService = {};
    const viewService = {
      restoreView: vi.fn().mockResolvedValue(undefined),
    };
    const dataPrismaService = {
      tableTrash: {
        count: vi.fn().mockResolvedValue(1),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const dataDbClientManager = {
      dataPrismaForTable: vi.fn().mockResolvedValue(dataPrismaService),
    };
    const operation = new DeleteViewOperation(
      viewOpenApiService as never,
      viewService as never,
      dataDbClientManager as never
    );

    await operation.undo({
      name: 'DeleteView',
      params: { tableId: 'tbl1', viewId: 'viw1' },
      operationId: 'otrash3',
    } as never);

    expect(viewService.restoreView).toHaveBeenCalledWith('tbl1', 'viw1');
    expect(dataPrismaService.tableTrash.delete).toHaveBeenCalledWith({
      where: { id: 'otrash3' },
    });
  });
});
