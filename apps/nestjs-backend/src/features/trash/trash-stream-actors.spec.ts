import { TableTrashType } from '@teable/openapi';
import type { RestoreRecordsStreamCommand } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { RecordRestoreService } from '../record/open-api/record-restore.service';
import { TrashService } from './trash.service';

describe('TrashService trusted stream creator provenance', () => {
  it('passes only persisted snapshot creator pairs, including explicit unknown, through the server option', async () => {
    const tableId = `tbl${'t'.repeat(16)}`;
    const knownId = `rec${'a'.repeat(16)}`;
    const unknownId = `rec${'b'.repeat(16)}`;
    const time = new Date('2026-01-01T00:00:00Z');
    const snapshots = [
      { id: knownId, fields: {}, createdByActorType: 'user', createdByActorId: 'usrOriginal' },
      { id: unknownId, fields: {} },
    ];
    const rows = snapshots.map((snapshot, index) => ({
      id: `trashRow${index}`,
      recordId: snapshot.id,
      createdTime: time,
      snapshot: JSON.stringify(snapshot),
    }));
    let captured: RestoreRecordsStreamCommand | undefined;
    const execute = vi.fn(async (_context: unknown, command: RestoreRecordsStreamCommand) => {
      captured = command;
      expect(command.trustedCreatedActorsByRecordId?.get(knownId)).toEqual({
        type: 'user',
        id: 'usrOriginal',
      });
      expect(command.trustedCreatedActorsByRecordId?.get(unknownId)).toBeNull();
      const records: unknown[] = [];
      for await (const record of command.records) records.push(record);
      expect(records).toHaveLength(2);
      expect(records.every((record) => !Object.hasOwn(record as object, 'createdByActorId'))).toBe(
        true
      );
      return ok(
        (async function* () {
          yield { id: 'done', restoredCount: 2 };
        })()
      );
    });
    const data = {
      tableTrash: {
        findUniqueOrThrow: async () => ({
          tableId,
          resourceType: TableTrashType.Record,
          snapshot: JSON.stringify([knownId, unknownId]),
          createdTime: time,
        }),
        deleteMany: vi.fn(),
      },
      recordTrash: { findMany: async () => rows, deleteMany: vi.fn() },
    };
    const service = Object.create(TrashService.prototype) as {
      restoreRecordTableResourceV2Stream: (
        trashId: string,
        tableId: string
      ) => AsyncIterable<unknown>;
    };
    Object.assign(service, {
      cls: { get: vi.fn() },
      assertTableWritable: vi.fn(),
      trashDataPrismaForTable: async () => data,
      permissionService: { validPermissions: vi.fn() },
      recordRestoreService: Object.create(RecordRestoreService.prototype),
      v2ContainerService: { getContainerForTable: async () => ({ resolve: () => ({ execute }) }) },
      v2ExecutionContextFactory: {
        createContext: async () => ({ initiator: { type: 'appUser', id: 'apuCurrent' } }),
      },
      trashDataPrismaTransactionForTable: async (
        _tableId: string,
        action: (prisma: typeof data) => Promise<void>
      ) => action(data),
      trashTombstoneClientForTable: async () => data,
      recordRemovalTombstoneService: { markRestored: vi.fn() },
    });
    for await (const event of service.restoreRecordTableResourceV2Stream(
      'trashOperation',
      tableId
    )) {
      void event;
    }
    expect(captured).toBeDefined();
    expect(execute).toHaveBeenCalledOnce();
    expect(data.recordTrash.deleteMany).toHaveBeenCalledOnce();
  });
});
