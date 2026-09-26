/* eslint-disable @typescript-eslint/no-explicit-any */
import { TableTrashType, TrashType } from '@teable/openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashService } from './trash.service';

describe('TrashService audit rows', () => {
  const audit = {
    emitAtomic: vi.fn(async () => undefined),
    withOperation: vi.fn(async (_input: unknown, fn: () => Promise<unknown>) => fn()),
  };
  const txClient = {
    trash: {
      findUniqueOrThrow: vi.fn(),
      deleteMany: vi.fn(),
    },
    space: { update: vi.fn() },
  };
  const prismaService = {
    $tx: vi.fn(async (fn: (client: typeof txClient) => Promise<unknown>) => fn(txClient)),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    txClient: vi.fn(() => txClient),
    trash: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
    },
    space: { findUnique: vi.fn() },
    base: { findUnique: vi.fn() },
  };
  const spaceService = { permanentDeleteSpace: vi.fn() };
  const baseService = { permanentDeleteBase: vi.fn() };
  const tableOpenApiService = { permanentDeleteTables: vi.fn() };
  const permissionService = { validPermissions: vi.fn() };

  const createService = () => {
    const service = new TrashService(
      { del: vi.fn() } as never,
      prismaService as never,
      { get: vi.fn().mockReturnValue(undefined) } as never,
      {} as never,
      permissionService as never,
      spaceService as never,
      baseService as never,
      tableOpenApiService as never,
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
      {} as never
    );
    (service as any).audit = audit;
    return service;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('restore', () => {
    it('writes space.restore once the restore committed', async () => {
      txClient.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'spc1',
        resourceType: TrashType.Space,
        parentId: null,
      });
      prismaService.space.findUnique.mockResolvedValue({ name: 'Sales' });

      await createService().restoreTrash('trh1');

      expect(txClient.space.update).toHaveBeenCalledWith({
        where: { id: 'spc1' },
        data: { deletedTime: null },
      });
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'space.restore',
        resourceId: 'spc1',
        params: { spaceId: 'spc1', name: 'Sales', trashId: 'trh1' },
      });
    });

    it('writes base.restore scoped to its space', async () => {
      txClient.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh2',
        resourceId: 'bse1',
        resourceType: TrashType.Base,
        parentId: 'spc1',
      });
      const service = createService();
      vi.spyOn(service as any, 'assertParentNotTrashed').mockResolvedValue(undefined);
      vi.spyOn(service, 'restoreResource').mockResolvedValue(undefined);
      prismaService.base.findUnique.mockResolvedValue({ name: 'CRM', spaceId: 'spc1' });

      await service.restoreTrash('trh2');

      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'base.restore',
        resourceId: 'bse1',
        params: { baseId: 'bse1', spaceId: 'spc1', name: 'CRM', trashId: 'trh2' },
      });
    });

    it('leaves a table restore to its own table.restore row', async () => {
      txClient.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh3',
        resourceId: 'tbl1',
        resourceType: TrashType.Table,
        parentId: 'bse1',
      });
      const service = createService();
      vi.spyOn(service as any, 'assertParentNotTrashed').mockResolvedValue(undefined);
      vi.spyOn(service, 'restoreResource').mockResolvedValue(undefined);

      await service.restoreTrash('trh3');

      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });

    it('writes nothing when the restore fails', async () => {
      txClient.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'spc1',
        resourceType: TrashType.Space,
        parentId: null,
      });
      const service = createService();
      vi.spyOn(service, 'restoreResource').mockRejectedValue(new Error('boom'));

      await expect(service.restoreTrash('trh1')).rejects.toThrow('boom');
      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });
  });

  describe('permanent delete', () => {
    it('writes base.permanent-delete with the name read before the purge', async () => {
      prismaService.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'bse1',
        resourceType: TrashType.Base,
        parentId: 'spc1',
      });
      prismaService.base.findUnique.mockResolvedValue({ name: 'CRM', spaceId: 'spc1' });

      await createService().delete('trh1');

      expect(baseService.permanentDeleteBase).toHaveBeenCalledWith('bse1', false);
      expect(prismaService.base.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
        baseService.permanentDeleteBase.mock.invocationCallOrder[0]
      );
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'base.permanent-delete',
        resourceId: 'bse1',
        params: { baseId: 'bse1', spaceId: 'spc1', name: 'CRM', trashId: 'trh1' },
      });
    });

    it('writes space.permanent-delete, flagged when a BYODB space is force removed', async () => {
      prismaService.trash.findUnique.mockResolvedValue({
        id: 'trh1',
        resourceId: 'spc1',
        resourceType: TrashType.Space,
        parentId: null,
      });
      prismaService.space.findUnique.mockResolvedValue({ name: 'Sales' });

      await createService().delete('trh1', false, { force: true });

      expect(spaceService.permanentDeleteSpace).toHaveBeenCalledWith('spc1', false, {
        force: true,
      });
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'space.permanent-delete',
        resourceId: 'spc1',
        params: { spaceId: 'spc1', name: 'Sales', trashId: 'trh1', force: true },
      });
    });

    it('leaves a table purge to the table service row', async () => {
      prismaService.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'tbl1',
        resourceType: TrashType.Table,
        parentId: 'bse1',
      });

      await createService().delete('trh1');

      expect(tableOpenApiService.permanentDeleteTables).toHaveBeenCalledWith('bse1', ['tbl1']);
      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });

    it('writes nothing for the retention sweep, which has no user', async () => {
      prismaService.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'bse1',
        resourceType: TrashType.Base,
        parentId: 'spc1',
      });

      await createService().delete('trh1', true);

      expect(baseService.permanentDeleteBase).toHaveBeenCalledWith('bse1', true);
      expect(prismaService.base.findUnique).not.toHaveBeenCalled();
      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });

    it('still purges when the name lookup fails', async () => {
      prismaService.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'bse1',
        resourceType: TrashType.Base,
        parentId: 'spc1',
      });
      prismaService.base.findUnique.mockRejectedValueOnce(new Error('db down'));

      await createService().delete('trh1');

      expect(baseService.permanentDeleteBase).toHaveBeenCalled();
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'base.permanent-delete',
        resourceId: 'bse1',
        params: { trashId: 'trh1' },
      });
    });
  });

  describe('reset', () => {
    it('writes one trash.reset row per base with what the trash held, in its own operation', async () => {
      prismaService.trash.findMany.mockResolvedValue([
        { resourceType: TrashType.Table },
        { resourceType: TrashType.Table },
        { resourceType: TrashType.App },
      ]);
      const service = createService();
      const resetBase = vi
        .spyOn(service as any, 'resetBaseTrashResource')
        .mockResolvedValue(undefined);

      await service.resetTrashItems({ resourceType: TrashType.Base, resourceId: 'bse1' });

      expect(audit.withOperation).toHaveBeenCalledWith(
        { rootAction: 'trash.reset', resourceId: 'bse1' },
        expect.any(Function)
      );
      expect(resetBase).toHaveBeenCalled();
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'trash.reset',
        resourceId: 'bse1',
        params: {
          resourceType: TrashType.Base,
          baseId: 'bse1',
          counts: { table: 2, app: 1 },
        },
      });
    });

    it('writes nothing when the base trash was already empty', async () => {
      prismaService.trash.findMany.mockResolvedValue([]);
      const service = createService();
      vi.spyOn(service as any, 'resetBaseTrashResource').mockResolvedValue(undefined);

      await service.resetTrashItems({ resourceType: TrashType.Base, resourceId: 'bse1' });

      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });

    it('counts the views, fields and records purged from a table trash', async () => {
      const service = createService();
      vi.spyOn(service as any, 'resetTableTrashItems').mockResolvedValue({
        view: 1,
        field: 2,
        record: 30,
      });

      await service.resetTrashItems({ resourceType: TrashType.Table, resourceId: 'tbl1' });

      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'trash.reset',
        resourceId: 'tbl1',
        params: {
          resourceType: TrashType.Table,
          tableId: 'tbl1',
          counts: { view: 1, field: 2, record: 30 },
        },
      });
    });

    it('returns the purged counts from the table trash reset', async () => {
      const service = createService();
      const tableTrash = {
        findMany: vi.fn().mockResolvedValue([
          { resourceType: TableTrashType.View, snapshot: JSON.stringify(['viw1']) },
          {
            resourceType: TableTrashType.Field,
            snapshot: JSON.stringify({ fields: [{ id: 'fld1' }, { id: 'fld2' }] }),
          },
          { resourceType: TableTrashType.Record, snapshot: JSON.stringify(['rec1', 'rec1']) },
        ]),
        deleteMany: vi.fn(),
      };
      vi.spyOn(service as any, 'trashDataPrismaForTable').mockResolvedValue({ tableTrash });
      vi.spyOn(service as any, 'trashDataPrismaTransactionForTable').mockResolvedValue(undefined);
      (service as any).recordRemovalColdStorageService = { deleteReasonPrefix: vi.fn() };
      const commentCleanup = { purgeRecordComments: vi.fn() };
      (service as any).recordCommentCleanupService = commentCleanup;
      prismaService.$tx.mockResolvedValueOnce(undefined);

      await expect((service as any).resetTableTrashItems('tbl1')).resolves.toEqual({
        view: 1,
        field: 2,
        record: 1,
      });
      expect(commentCleanup.purgeRecordComments).toHaveBeenCalledWith('tbl1', ['rec1']);
    });
  });
});
