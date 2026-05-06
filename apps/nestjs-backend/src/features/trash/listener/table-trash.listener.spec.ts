import { ResourceType } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';

import type { IDeleteFieldsPayload } from '../../undo-redo/operations/delete-fields.operation';
import type { IDeleteRecordsPayload } from '../../undo-redo/operations/delete-records.operation';
import type { IDeleteViewPayload } from '../../undo-redo/operations/delete-view.operation';
import { TableTrashListener } from './table-trash.listener';

describe('TableTrashListener', () => {
  it('persists record delete snapshots through the data prisma transaction', async () => {
    const tableTrashCreate = vi.fn().mockResolvedValue(undefined);
    const recordTrashCreateMany = vi.fn().mockResolvedValue(undefined);
    const txClient = {
      tableTrash: {
        create: tableTrashCreate,
      },
      recordTrash: {
        createMany: recordTrashCreateMany,
      },
    };
    const dataPrismaService = {
      $tx: vi.fn(async (callback: (prisma: typeof txClient) => Promise<void>) =>
        callback(txClient)
      ),
      tableTrash: {
        create: vi.fn(),
      },
    };
    const listener = new TableTrashListener(
      dataPrismaService as never,
      {
        bigTransactionTimeout: 30_000,
      } as never
    );
    const payload: IDeleteRecordsPayload = {
      operationId: 'oprTrashListenerRecord',
      tableId: 'tblTrashListenerTable',
      userId: 'usrTrashListenerUser',
      records: [
        { id: 'recTrashListenerOne', fields: { fldText: 'A' } },
        { id: 'recTrashListenerTwo', fields: { fldText: 'B' } },
      ],
    };

    await listener.recordDeleteListener(payload);

    expect(dataPrismaService.$tx).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 30_000,
    });
    expect(tableTrashCreate).toHaveBeenCalledWith({
      data: {
        id: 'oprTrashListenerRecord',
        tableId: 'tblTrashListenerTable',
        createdBy: 'usrTrashListenerUser',
        resourceType: ResourceType.Record,
        snapshot: JSON.stringify(['recTrashListenerOne', 'recTrashListenerTwo']),
        createdTime: expect.any(Date),
      },
    });
    expect(recordTrashCreateMany).toHaveBeenCalledWith({
      data: [
        {
          id: expect.any(String),
          tableId: 'tblTrashListenerTable',
          recordId: 'recTrashListenerOne',
          snapshot: JSON.stringify({ id: 'recTrashListenerOne', fields: { fldText: 'A' } }),
          createdBy: 'usrTrashListenerUser',
          createdTime: expect.any(Date),
        },
        {
          id: expect.any(String),
          tableId: 'tblTrashListenerTable',
          recordId: 'recTrashListenerTwo',
          snapshot: JSON.stringify({ id: 'recTrashListenerTwo', fields: { fldText: 'B' } }),
          createdBy: 'usrTrashListenerUser',
          createdTime: expect.any(Date),
        },
      ],
    });

    const tableTrashData = tableTrashCreate.mock.calls[0][0].data as { createdTime: Date };
    const recordTrashData = recordTrashCreateMany.mock.calls[0][0].data as Array<{
      createdTime: Date;
    }>;
    expect(recordTrashData.every((row) => row.createdTime === tableTrashData.createdTime)).toBe(
      true
    );
  });

  it('persists field and view delete snapshots through the data prisma client', async () => {
    const tableTrashCreate = vi.fn().mockResolvedValue(undefined);
    const dataPrismaService = {
      $tx: vi.fn(),
      tableTrash: {
        create: tableTrashCreate,
      },
    };
    const listener = new TableTrashListener(
      dataPrismaService as never,
      {
        bigTransactionTimeout: 30_000,
      } as never
    );
    const fieldPayload: IDeleteFieldsPayload = {
      operationId: 'oprTrashListenerField',
      tableId: 'tblTrashListenerTable',
      userId: 'usrTrashListenerUser',
      fields: [{ id: 'fldTrashListenerField', name: 'Name' }] as never,
      records: [{ id: 'recTrashListenerOne', fields: { fldText: 'A' } }] as never,
    };
    const viewPayload: IDeleteViewPayload = {
      operationId: 'oprTrashListenerView',
      tableId: 'tblTrashListenerTable',
      userId: 'usrTrashListenerUser',
      viewId: 'viwTrashListenerView',
    };

    await listener.fieldDeleteListener(fieldPayload);
    await listener.viewDeleteListener(viewPayload);

    expect(tableTrashCreate).toHaveBeenNthCalledWith(1, {
      data: {
        id: 'oprTrashListenerField',
        tableId: 'tblTrashListenerTable',
        createdBy: 'usrTrashListenerUser',
        resourceType: ResourceType.Field,
        snapshot: JSON.stringify({
          fields: fieldPayload.fields,
          records: fieldPayload.records,
        }),
      },
    });
    expect(tableTrashCreate).toHaveBeenNthCalledWith(2, {
      data: {
        id: 'oprTrashListenerView',
        tableId: 'tblTrashListenerTable',
        createdBy: 'usrTrashListenerUser',
        resourceType: ResourceType.View,
        snapshot: JSON.stringify(['viwTrashListenerView']),
      },
    });
  });
});
